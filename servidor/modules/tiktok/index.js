const { createTikTokMonitorService } = require('./tiktokMonitorService');
const { eventLabels, eventNames } = require('./eventConfig');
const { translateGiftName } = require('./giftTranslationService');
const fs = require('node:fs');
const path = require('node:path');
const { registerTikTokRoutes } = require('./routes');

const maxEvents = 500;

function createTikTokModule({
  stream,
  gameStream,
  gameModule,
  monitorService = createTikTokMonitorService(),
  configurationPath = process.env.WEBSERVER_CONFIG_PATH || path.join(__dirname, '..', '..', 'data', 'monitor-config.json'),
} = {}) {
  if (!stream || typeof stream.attach !== 'function' || typeof stream.broadcast !== 'function') {
    throw new Error('El módulo TikTok necesita su canal de eventos.');
  }
  if (!gameModule || typeof gameModule.handleLiveEvent !== 'function') {
    throw new Error('El módulo TikTok necesita conectarse al módulo del juego.');
  }
  if (typeof gameModule.noteLiveActivity !== 'function') {
    throw new Error('El módulo del juego debe informar cuándo reiniciar el temporizador de inactividad.');
  }
  if (!gameStream || typeof gameStream.broadcast !== 'function') {
    throw new Error('El módulo TikTok necesita publicar el modo de conexión del juego.');
  }

  const { events: availableEvents, labels: availableLabels, enabled } = monitorService.getAvailableEventsPayload();
  const enabledEvents = new Set(enabled);
  const eventHistory = [];
  const events = [];
  let ignoredEvents = new Set();
  let configuration = { username: '', saved: false };

  try {
    const savedConfiguration = JSON.parse(fs.readFileSync(configurationPath, 'utf8'));
    if (typeof savedConfiguration.username !== 'string' || !Array.isArray(savedConfiguration.ignoredEvents)
      || savedConfiguration.ignoredEvents.some((eventName) => typeof eventName !== 'string')) {
      throw new Error('La configuración guardada del servidor no es válida.');
    }
    configuration = { username: savedConfiguration.username, saved: true };
    ignoredEvents = new Set(savedConfiguration.ignoredEvents);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const state = {
    connected: Boolean(monitorService.state.isConnected),
    status: monitorService.state.status,
    monitorStatus: monitorService.state.status,
    monitorError: monitorService.state.error || '',
    error: '',
    eventTypes: [...enabledEvents].filter((eventName) => !ignoredEvents.has(eventName)).length,
    username: configuration.username,
    lastEventAt: null,
    botActive: false,
  };

  function publish(event, payload) {
    stream.broadcast(event, payload);
  }

  function applyEventFilter(publishSnapshot = true) {
    events.splice(0, events.length, ...eventHistory
      .filter((entry) => enabledEvents.has(entry.type) && !ignoredEvents.has(entry.type)));
    state.eventTypes = [...enabledEvents].filter((eventName) => !ignoredEvents.has(eventName)).length;
    if (publishSnapshot) publish('snapshot', events);
    publish('status', { ...state });
  }

  function handleTikTokEvent(entry) {
    if (!entry || typeof entry !== 'object' || typeof entry.type !== 'string') return;
    gameModule.noteLiveActivity(entry);

    eventHistory.unshift(entry);
    eventHistory.length = Math.min(eventHistory.length, maxEvents);
    state.lastEventAt = entry.time || new Date().toISOString();
    if (!enabledEvents.has(entry.type) || ignoredEvents.has(entry.type)) return;

    events.unshift(entry);
    events.length = Math.min(events.length, maxEvents);
    publish('update', { entry, events });
    try {
      gameModule.handleLiveEvent(entry);
    } catch (error) {
      state.error = error.message || String(error);
      console.error('No se pudo procesar la interacción de TikTok.', error);
      publish('status', { ...state });
    }
  }

  const unsubscribeEvents = monitorService.subscribeToEvents(handleTikTokEvent);
  const unsubscribeStatus = monitorService.subscribeToStatus((monitorStatus) => {
    state.connected = monitorStatus.isConnected;
    state.status = monitorStatus.status;
    state.monitorStatus = monitorStatus.status;
    state.monitorError = monitorStatus.error || '';
    state.error = monitorStatus.error || '';
    state.username = monitorStatus.username || '';
    publish('status', { ...state });
    gameStream.broadcast('mode', {
      botActive: false,
      label: monitorStatus.isConnected ? 'Conector TikTok en vivo' : 'Conector TikTok',
    });
  });

  function getConfiguration() {
    return {
      username: configuration.username,
      ignoredEvents: [...ignoredEvents],
      events: availableEvents.map((name) => ({
        name,
        label: availableLabels[name] || name,
        enabled: enabledEvents.has(name),
      })).sort((first, second) => Number(second.enabled) - Number(first.enabled)),
    };
  }

  function saveConfiguration(body) {
    const username = typeof body?.username === 'string'
      ? body.username.trim().replace(/^@+/, '')
      : '';
    const submittedIgnoredEvents = body?.ignoredEvents;
    if (!username || !Array.isArray(submittedIgnoredEvents)
      || submittedIgnoredEvents.some((name) => typeof name !== 'string' || !availableEvents.includes(name))) {
      return { ok: false, message: 'Revisa el usuario y los eventos ignorados.' };
    }

    const uniqueIgnoredEvents = [...new Set(submittedIgnoredEvents)];
    monitorService.connectUser(username);
    const savedConfiguration = { username, ignoredEvents: uniqueIgnoredEvents };
    fs.mkdirSync(path.dirname(configurationPath), { recursive: true });
    fs.writeFileSync(configurationPath, JSON.stringify(savedConfiguration, null, 2));
    configuration = { username, saved: true };
    ignoredEvents = new Set(uniqueIgnoredEvents);
    applyEventFilter();
    return { ok: true, username, ignoredEvents: uniqueIgnoredEvents };
  }

  function getStatus() {
    return {
      ...state,
      eventCount: events.length,
      connector: monitorService.getStatusPayload(),
    };
  }

  function getModePayload() {
    return {
      botActive: false,
      label: monitorService.state.isConnected ? 'Conector TikTok en vivo' : 'Conector TikTok',
    };
  }

  function openEventStream(response) {
    stream.attach(response, [
      ['status', { ...state }],
      ['snapshot', events],
    ]);
  }

  function registerRoutes(app) {
    registerTikTokRoutes(app, { getStatus, getConfiguration, saveConfiguration, openEventStream });
  }

  if (configuration.username) monitorService.connectUser(configuration.username);

  return {
    monitorService,
    getModePayload,
    registerRoutes,
    close() {
      unsubscribeEvents();
      unsubscribeStatus();
      monitorService.disconnectUser();
    },
  };
}

module.exports = {
  createTikTokModule,
  createTikTokMonitorService,
  eventLabels,
  eventNames,
  translateGiftName,
};
