const assert = require('node:assert/strict');
const test = require('node:test');
const { createGameStateService } = require('../modules/game/services/gameStateService');
const { createWarRulesService } = require('../modules/game/services/warRulesService');

function createWar() {
  const gameStateService = createGameStateService({ random: () => 0 });
  const war = createWarRulesService({ gameStateService });
  return { gameStateService, war };
}

function resetBoard(game, changes) {
  for (let index = 0; index < 25; index += 1) game.updateCell(index, { owner: null, points: 0 });
  for (const [index, owner, points] of changes) game.updateCell(index, { owner, points });
}

test('war movement resolves attrition, neutral claims, reinforcement, attack, draw, and conquest', () => {
  const cases = [
    { target: null, defense: 0, sent: 5, to: 6, result: 'claim', points: 1, owner: 'A' },
    { target: 'A', defense: 98, sent: 5, to: 1, result: 'reinforce', points: 100, owner: 'A' },
    { target: 'B', defense: 2, sent: 5, to: 1, result: 'conquest', points: 1, owner: 'A' },
    { target: 'B', defense: 3, sent: 5, to: 1, result: 'neutralized', points: 0, owner: null },
    { target: 'B', defense: 4, sent: 5, to: 1, result: 'attack', points: 1, owner: 'B' },
    { target: null, defense: 0, sent: 3, to: 6, result: 'attrition', points: 0, owner: null },
  ];

  for (const scenario of cases) {
    const { gameStateService, war } = createWar();
    resetBoard(gameStateService, [
      [0, 'A', scenario.sent],
      ...(scenario.target === null ? [] : [[scenario.to, scenario.target, scenario.defense]]),
    ]);
    const result = war.applyAction('A', scenario.to, {
      type: 'move',
      fromCellIndex: 0,
      troops: scenario.sent,
    });
    assert.ok(result.effects.includes(scenario.result), scenario.result);
    assert.equal(gameStateService.getSnapshot().board[scenario.to].owner, scenario.owner);
    assert.equal(gameStateService.getSnapshot().board[scenario.to].points, scenario.points);
  }
});

test('war action and movement input validation rejects malformed requests', () => {
  const { gameStateService, war } = createWar();
  assert.throws(() => war.applyAction('C', 0, { type: 'donation' }), /país debe ser A o B/);
  assert.throws(() => war.applyAction('A', -1, { type: 'donation' }), /entre 0 y 24/);
  assert.throws(() => war.applyAction('A', 0, []), /acción táctica/);
  assert.throws(() => war.applyAction('A', 0, { type: 'unknown' }), /tipo de acción/);
  for (const troops of [0, 101, 2.5]) {
    assert.throws(() => war.applyAction('A', 0, { type: 'donation', troops }), /entre 1 y 100/);
  }

  const invalidOrigins = [-1, 25, 1.5];
  for (const fromCellIndex of invalidOrigins) {
    assert.throws(() => war.applyAction('A', 1, {
      type: 'move',
      fromCellIndex,
    }), /origen.*entre 0 y 24/);
  }
  assert.throws(() => war.applyAction('A', 0, { type: 'move', fromCellIndex: 0 }), /distintas/);
  assert.throws(() => war.applyAction('B', 1, { type: 'move', fromCellIndex: 0 }), /pertenecer a tu país/);
  const source = gameStateService.getSnapshot().countries.find((country) => country.id === 'A').capitalCell;
  const target = source === 24 ? 23 : source + 1;
  gameStateService.updateCell(source, { owner: 'A', points: 5 });
  assert.throws(() => war.applyAction('A', target, {
    type: 'move',
    fromCellIndex: source,
    troops: 6,
  }), /suficientes tropas/);
});

test('war actions claim, reinforce, redirect, attack, conquer, and neutralize', () => {
  const { gameStateService, war } = createWar();
  resetBoard(gameStateService, [[0, 'A', 100], [1, 'A', 80], [5, 'A', 100]]);
  const redirected = war.applyAction('A', 0, { type: 'donation' });
  assert.ok(redirected.effects.includes('fortified'));
  assert.equal(gameStateService.getSnapshot().board[1].points, 81);

  resetBoard(gameStateService, Array.from({ length: 25 }, (_, index) => [index, 'A', 100]));
  const blocked = war.applyAction('A', 0, { type: 'donation' });
  assert.ok(blocked.effects.includes('overflow-blocked'));

  resetBoard(gameStateService, [[0, 'A', 10], [1, 'A', 80]]);
  const reinforcement = war.applyAction('A', 0, { type: 'donation', troops: 3 });
  assert.ok(reinforcement.effects.includes('reinforce'));
  assert.equal(gameStateService.getSnapshot().board[0].points, 13);

  resetBoard(gameStateService, [[0, 'A', 10], [1, null, 0]]);
  assert.ok(war.applyAction('A', 1, { type: 'interaction' }).effects.includes('claim'));

  resetBoard(gameStateService, [[0, 'A', 10], [1, 'B', 2]]);
  assert.ok(war.applyAction('A', 1, { type: 'interaction' }).effects.includes('interaction-ignored'));
  assert.ok(war.applyAction('A', 1, { type: 'donation', troops: 2 }).effects.includes('attack'));
  resetBoard(gameStateService, [[0, 'A', 10], [1, 'B', 1]]);
  assert.ok(war.applyAction('A', 1, { type: 'donation' }).effects.includes('conquest'));
  resetBoard(gameStateService, [[0, 'A', 10], [1, 'B', 1]]);
  assert.ok(war.applyAction('A', 1, { type: 'donation', troops: 2 }).effects.includes('conquest'));
});

test('automatic front advance follows its route, stops at victory, and reports blocked paths', () => {
  const { gameStateService, war } = createWar();
  const { countries } = gameStateService.getSnapshot();
  const ownCapital = countries.find((country) => country.id === 'A').capitalCell;
  const enemyCapital = countries.find((country) => country.id === 'B').capitalCell;

  for (const [team, advances] of [['C', 1], ['A', 0], ['A', 101], ['A', 1.5]]) {
    assert.throws(() => war.advanceFront(team, advances), /país debe ser A o B|avances debe ser/);
  }

  resetBoard(gameStateService, [[ownCapital, 'A', 3]]);
  const blocked = war.advanceFront('A');
  assert.equal(blocked.advances, 0);
  assert.deepEqual(blocked.effects, ['no-path']);

  gameStateService.updateCell(ownCapital, { owner: 'B', points: 10 });
  assert.equal(war.advanceFront('A').winner, 'B');

  resetBoard(gameStateService, [[ownCapital, 'A', 20], [enemyCapital, 'B', 100]]);
  const advance = war.advanceFront('A', 3);
  assert.ok(advance.advances > 0);
  assert.ok(advance.effects.includes('movement'));
  assert.ok(advance.cells.length > 0);
});
