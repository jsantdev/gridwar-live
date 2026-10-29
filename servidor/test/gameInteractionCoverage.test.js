const assert = require('node:assert/strict');
const test = require('node:test');
const { createGameInteractionService } = require('../modules/game/services/gameInteractionService');
const { createGameStateService } = require('../modules/game/services/gameStateService');
const { createWarRulesService } = require('../modules/game/services/warRulesService');

function createServices(random = () => 0) {
  const gameStateService = createGameStateService({ random: () => 0 });
  const warRulesService = createWarRulesService({ gameStateService });
  const interactions = createGameInteractionService({ gameStateService, warRulesService, random });
  return { gameStateService, interactions };
}

function setCells(game, changes) {
  for (const [index, owner, points] of changes) game.updateCell(index, { owner, points });
}

test('game interactions validates its dependencies and rejects troop overflow without corrupting state', () => {
  const { gameStateService, interactions } = createServices();
  const warRulesService = createWarRulesService({ gameStateService });
  assert.throws(() => createGameInteractionService(), /servicios de estado y reglas válidos/);
  assert.throws(() => createGameInteractionService({
    gameStateService,
    warRulesService,
    random: null,
  }), /servicios de estado y reglas válidos/);

  const state = gameStateService.getSnapshot();
  const source = state.countries.find((country) => country.id === 'A').capitalCell;
  const target = 12;
  gameStateService.updateCell(source, { owner: 'A', points: 10 });
  gameStateService.updateCell(target, { owner: 'A', points: 100 });
  assert.throws(() => interactions.resolveAndApplyTroopAction('A', source, target, 1), /más de 100 tropas/);
  assert.equal(gameStateService.getSnapshot().board[target].points, 100);
});

test('inactivity actions attack, mobilize, reinforce, fall back, and stop on a full board', () => {
  const actionRandomValues = [0, 0.34, 0.67, 0];
  let randomCalls = 0;
  const { gameStateService, interactions } = createServices(() => {
    const value = randomCalls % 2 === 0 ? actionRandomValues[Math.floor(randomCalls / 2)] ?? 0 : 0;
    randomCalls += 1;
    return value;
  });
  setCells(gameStateService, [[0, 'A', 10], [1, 'B', 8], [5, null, 0]]);

  const attack = interactions.runInactivityAction('A');
  assert.equal(attack.actionType, 'attack');
  assert.equal(gameStateService.getSnapshot().board[1].points, 5);

  const mobilize = interactions.runInactivityAction('A');
  assert.equal(mobilize.actionType, 'mobilization');
  assert.equal(gameStateService.getSnapshot().board[5].owner, 'A');

  gameStateService.updateCell(2, { owner: 'A', points: 7 });
  const reinforce = interactions.runInactivityAction('A');
  assert.equal(reinforce.actionType, 'reinforcement');

  setCells(gameStateService, Array.from({ length: 25 }, (_, index) => [index, null, 0]));
  setCells(gameStateService, [[0, 'A', 10], [1, 'A', 5]]);
  const fallback = interactions.runInactivityAction('A');
  assert.equal(fallback.actionType, 'attack');
  assert.ok(fallback.effects.includes('movement'));

  setCells(gameStateService, Array.from({ length: 25 }, (_, index) => [index, 'A', 100]));
  assert.equal(interactions.runInactivityAction('A'), null);
});

test('live interactions cap counts, accumulate likes, route gifts, and ignore unsupported events', () => {
  const { gameStateService, interactions } = createServices();
  setCells(gameStateService, [[0, 'A', 50], [1, null, 0], [5, 'A', 40], [6, 'B', 20]]);

  assert.equal(interactions.processLiveEvent(null), null);
  assert.equal(interactions.processLiveEvent({ type: 'unknown', username: 'visitor' }), null);

  const chat = interactions.processLiveEvent({ type: 'chat', username: 'chatter', activityCount: 150 });
  assert.equal(chat.trigger, 'chat');
  assert.equal(gameStateService.getSnapshot().leaders.A[0].score, 100);

  const noAdvanceLike = interactions.processLiveEvent({ type: 'like', username: 'liker', activityCount: 9 });
  assert.deepEqual(noAdvanceLike.effects, []);
  const cappedLikes = interactions.processLiveEvent({ type: 'like', username: 'liker', activityCount: 150 });
  assert.equal(cappedLikes.trigger, 'like');

  setCells(gameStateService, Array.from({ length: 25 }, (_, index) => [index, 'A', 100]));
  const noDiamonds = interactions.processLiveEvent({ type: 'gift', username: 'gift-zero', diamondCount: 0 });
  assert.equal(noDiamonds.type, 'activity');
  assert.equal(gameStateService.getSnapshot().leaders.A.find((leader) => leader.username === 'gift-zero').score, 1);

  const missingTarget = interactions.processLiveEvent({ type: 'gift', username: 'gift-no-path', diamondCount: 5 });
  assert.equal(missingTarget.type, 'activity');

  for (const type of ['follow', 'share', 'member']) {
    const result = interactions.processLiveEvent({ type, username: `${type}-user` });
    assert.equal(result.trigger, type);
    assert.equal(result.type, 'activity');
  }
});

test('large gifts prefer an open capital, and invalid activity counts use a single action', () => {
  const { gameStateService, interactions } = createServices();
  const { countries } = gameStateService.getSnapshot();
  const capital = countries.find((country) => country.id === 'A').capitalCell;
  const source = capital % 5 < 4 ? capital + 1 : capital - 1;
  setCells(gameStateService, Array.from({ length: 25 }, (_, index) => [index, null, 0]));
  setCells(gameStateService, [[capital, 'A', 90], [source, 'A', 50]]);
  const result = interactions.processLiveEvent({
    type: 'gift',
    username: 'large-gifter',
    activityCount: -1,
    diamondCount: 120,
  });
  assert.equal(result.trigger, 'gift');
  assert.equal(result.sent, 10);

  const malformedCount = interactions.processLiveEvent({
    type: 'like',
    username: 'odd-count',
    activityCount: 1.2,
  });
  assert.equal(malformedCount.trigger, 'like');
  const leaders = Object.values(gameStateService.getSnapshot().leaders).flat();
  assert.equal(leaders.find((leader) => leader.username === 'odd-count').score, 1);
});
