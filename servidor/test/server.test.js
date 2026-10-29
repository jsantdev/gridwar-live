const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createWebserver } = require('../server');
const { createGameStateService } = require('../modules/game/services/gameStateService');

function createMonitorService() {
  let eventListener;
  let statusListener;
  const service = {
    state: { username: '', status: 'idle', isConnected: false, error: '' },
    getAvailableEventsPayload: () => ({
      events: ['chat', 'gift', 'like', 'follow', 'share', 'member'],
      labels: { chat: 'Comentario', gift: 'Regalo', like: 'Me gusta' },
      enabled: ['chat', 'gift', 'like', 'follow', 'share', 'member'],
    }),
    getStatusPayload: () => ({ ...service.state }),
    getEventFeed: () => [],
    subscribeToEvents(listener) {
      eventListener = listener;
      return () => { eventListener = null; };
    },
    subscribeToStatus(listener) {
      statusListener = listener;
      return () => { statusListener = null; };
    },
    connectUser(username) {
      Object.assign(service.state, { username, status: 'connected', isConnected: true, error: '' });
      statusListener?.({ ...service.state });
    },
    disconnectUser() {
      Object.assign(service.state, { username: '', status: 'disconnected', isConnected: false });
      statusListener?.({ ...service.state });
    },
    emit(entry) {
      eventListener(entry);
    },
  };
  return service;
}

function createFakeTimers() {
  let nextId = 0;
  const timers = new Map();
  return {
    timers,
    schedule(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, delay });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    fire() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
  };
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  const closed = once(server, 'close');
  server.close();
  await closed;
}

test('game server hosts the TikTok connector, updates diamond leaders, and broadcasts SSE', async () => {
  const monitorService = createMonitorService();
  const configurationPath = path.join(os.tmpdir(), `game-config-${randomUUID()}.json`);
  const { server } = createWebserver({
    monitorService,
    configurationPath,
    troopRegenerationIntervalMs: 100000,
    inactivityTimeoutMs: 100000,
    gameStateService: createGameStateService({ random: () => 0 }),
    random: () => 0,
  });
  const baseUrl = await listen(server);
  let reader;

  try {
    const overlayPage = await fetch(`${baseUrl}/`);
    assert.equal(overlayPage.status, 200);
    assert.match(await overlayPage.text(), /Tablero de 25 casillas/);

    const backendPage = await fetch(`${baseUrl}/backend`);
    assert.equal(backendPage.status, 200);
    assert.match(await backendPage.text(), /Centro de batalla/);

    const legacyPanel = await fetch(`${baseUrl}/panel`, { redirect: 'manual' });
    assert.equal(legacyPanel.status, 308);
    assert.equal(legacyPanel.headers.get('location'), '/backend');

    const stream = await fetch(`${baseUrl}/api/game-state/stream`);
    reader = stream.body.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /event: snapshot/);

    const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
    assert.equal(config.events.find((event) => event.name === 'gift').enabled, true);

    const connect = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '@battlehost', ignoredEvents: ['follow'] }),
    }).then((response) => response.json());
    assert.equal(connect.username, 'battlehost');

    monitorService.emit({
      type: 'gift',
      username: 'lion-fan',
      time: new Date().toISOString(),
      content: 'Envió León',
      activityCount: 1,
      diamondCount: 299,
    });

    let update = '';
    while (!update.includes('"trigger":"gift"')) {
      const next = await reader.read();
      assert.equal(next.done, false);
      update += new TextDecoder().decode(next.value);
    }
    assert.match(update, /"countryId":"A"/);
    assert.match(update, /"actionType":"invasion"/);

    const gameState = await fetch(`${baseUrl}/api/game-state`).then((response) => response.json());
    assert.equal(gameState.leaders.A[0].username, 'lion-fan');
    assert.equal(gameState.leaders.A[0].score, 299);
  } finally {
    await reader?.cancel();
    await close(server);
    fs.rmSync(configurationPath, { force: true });
  }
});

test('inactivity actions alternate teams, reset after a live event, and use the troop resolver', async () => {
  const timers = createFakeTimers();
  const monitorService = createMonitorService();
  const configurationPath = path.join(os.tmpdir(), `game-config-${randomUUID()}.json`);
  const { server } = createWebserver({
    monitorService,
    configurationPath,
    troopRegenerationIntervalMs: 100000,
    inactivityTimeoutMs: 10000,
    scheduleInactivityTimeout: timers.schedule,
    cancelInactivityTimeout: timers.cancel,
    gameStateService: createGameStateService({ random: () => 0 }),
    random: () => 0,
  });
  const baseUrl = await listen(server);
  let reader;

  try {
    const stream = await fetch(`${baseUrl}/api/game-state/stream`);
    reader = stream.body.getReader();
    await reader.read();
    assert.equal(timers.timers.size, 1);
    assert.equal([...timers.timers.values()][0].delay, 10000);

    monitorService.emit({ type: 'like', username: 'active-user', activityCount: 1 });
    assert.equal(timers.timers.size, 1);
    timers.fire();

    let firstUpdate = '';
    while (!firstUpdate.includes('"simulated":true')) {
      const next = await reader.read();
      assert.equal(next.done, false);
      firstUpdate += new TextDecoder().decode(next.value);
    }
    assert.match(firstUpdate, /"countryId":"A"/);
    assert.match(firstUpdate, /"source":/);
    assert.match(firstUpdate, /"target":/);

    timers.fire();
    let secondUpdate = '';
    while (!secondUpdate.includes('"simulated":true')) {
      const next = await reader.read();
      assert.equal(next.done, false);
      secondUpdate += new TextDecoder().decode(next.value);
    }
    assert.match(secondUpdate, /"countryId":"B"/);
  } finally {
    await reader?.cancel();
    await close(server);
    fs.rmSync(configurationPath, { force: true });
  }
});

test('business module routes preserve the HTTP contracts and report invalid requests', async () => {
  const configurationPath = path.join(os.tmpdir(), `game-config-${randomUUID()}.json`);
  const { server } = createWebserver({
    monitorService: createMonitorService(),
    configurationPath,
    troopRegenerationIntervalMs: 100000,
    inactivityTimeoutMs: 100000,
    gameStateService: createGameStateService({ random: () => 0 }),
    random: () => 0,
  });
  const baseUrl = await listen(server);
  let eventReader;

  async function sendJson(route, method, body) {
    return fetch(`${baseUrl}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  try {
    const status = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
    assert.equal(status.connector.status, 'idle');

    const eventResponse = await fetch(`${baseUrl}/api/events`);
    eventReader = eventResponse.body.getReader();
    assert.match(new TextDecoder().decode((await eventReader.read()).value), /event: status/);

    const invalidConfig = await sendJson('/api/config', 'PUT', { username: '', ignoredEvents: [] });
    assert.equal(invalidConfig.status, 400);
    assert.equal((await invalidConfig.json()).ok, false);

    const state = await fetch(`${baseUrl}/api/game-state`).then((response) => response.json());
    const sourceIndex = state.countries.find((country) => country.id === 'A').capitalCell;
    const neutralIndex = state.board.find((cell) => cell.owner === null).index;

    const country = await sendJson('/api/game-state/countries/A', 'PATCH', {
      name: 'Equipo Azul',
      capital: 'Norte',
    });
    assert.equal((await country.json()).result.name, 'Equipo Azul');

    const points = await sendJson('/api/game-state/countries/A/points', 'POST', { delta: 5 });
    assert.equal((await points.json()).state.countries[0].points, 5);

    const morale = await sendJson('/api/game-state/countries/A/morale', 'POST', { delta: -10 });
    assert.equal((await morale.json()).state.countries[0].morale, 90);

    const member = await sendJson('/api/game-state/countries/A/members', 'POST', {
      username: 'test-player',
      interactions: 2,
    });
    assert.equal((await member.json()).result[0].username, 'test-player');

    const cell = await sendJson(`/api/game-state/board/${neutralIndex}`, 'PUT', { owner: 'A', points: 5 });
    assert.equal((await cell.json()).result.owner, 'A');

    const action = await sendJson('/api/game-state/actions', 'POST', {
      countryId: 'A',
      cellIndex: neutralIndex,
      type: 'donation',
      troops: 2,
    });
    assert.equal(action.status, 200);

    const mobilization = await sendJson('/api/game-state/actions', 'POST', {
      type: 'troop',
      teamId: 'A',
      sourceIndex,
      targetIndex: neutralIndex,
      sentAmount: 2,
    });
    assert.equal(mobilization.status, 200);
    assert.equal((await mobilization.json()).result.actionType, 'mobilization');

    const unknownCountry = await sendJson('/api/game-state/countries/C', 'PATCH', { name: 'No' });
    assert.equal(unknownCountry.status, 404);
    const unknownApi = await fetch(`${baseUrl}/api/not-a-route`);
    assert.equal(unknownApi.status, 404);
    const invalidJson = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(invalidJson.status, 400);
  } finally {
    await eventReader?.cancel();
    await close(server);
    fs.rmSync(configurationPath, { force: true });
  }
});

test('server surfaces a malformed saved TikTok configuration instead of ignoring it', () => {
  const configurationPath = path.join(os.tmpdir(), `game-config-${randomUUID()}.json`);
  fs.writeFileSync(configurationPath, JSON.stringify({ username: 42, ignoredEvents: [] }));

  try {
    assert.throws(() => createWebserver({
      monitorService: createMonitorService(),
      configurationPath,
      troopRegenerationIntervalMs: 100000,
      inactivityTimeoutMs: 100000,
    }), /configuración guardada.*no es válida/);
  } finally {
    fs.rmSync(configurationPath, { force: true });
  }
});
