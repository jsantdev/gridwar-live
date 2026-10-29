const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTroopAction } = require('../modules/game/services/troopActionService');

function createGameState(targetOwner = 'B', targetPoints = 5) {
  const board = Array.from({ length: 25 }, (_, index) => ({
    index,
    owner: null,
    points: 0,
    capitalFor: null,
  }));
  board[0] = { index: 0, owner: 'A', points: 10, capitalFor: 'A' };
  board[1] = { index: 1, owner: targetOwner, points: targetPoints, capitalFor: null };
  return { countries: [], board, leaders: { A: [], B: [] } };
}

test('resolveTroopAction reinforces a friendly cell and deducts sent troops', () => {
  const state = createGameState('A', 3);

  const result = resolveTroopAction(state, 'A', 0, 1, 4);

  assert.equal(result.type, 'fortified');
  assert.deepEqual(result.effects, ['fortified']);
  assert.equal(state.board[0].points, 6);
  assert.equal(state.board[1].points, 7);
});

test('resolveTroopAction conquers neutral and outnumbered enemy cells', () => {
  const neutral = createGameState(null, 0);
  const neutralResult = resolveTroopAction(neutral, 'A', 0, 1, 4);
  assert.equal(neutralResult.type, 'invasion');
  assert.equal(neutral.board[1].owner, 'A');
  assert.equal(neutral.board[1].points, 4);

  const conquered = createGameState('B', 3);
  const conquestResult = resolveTroopAction(conquered, 'A', 0, 1, 5);
  assert.equal(conquestResult.type, 'invasion');
  assert.deepEqual(conquestResult.effects, ['conquest']);
  assert.equal(conquered.board[1].owner, 'A');
  assert.equal(conquered.board[1].points, 2);
});

test('resolveTroopAction attacks or neutralizes based on equal troop counts', () => {
  const attack = createGameState('B', 6);
  const attackResult = resolveTroopAction(attack, 'A', 0, 1, 2);
  assert.equal(attackResult.type, 'attack');
  assert.equal(attack.board[1].points, 4);

  const draw = createGameState('B', 4);
  const drawResult = resolveTroopAction(draw, 'A', 0, 1, 4);
  assert.equal(drawResult.type, 'draw');
  assert.equal(draw.board[1].owner, null);
  assert.equal(draw.board[1].points, 0);
});

test('resolveTroopAction validates before changing the board', () => {
  const state = createGameState();
  const before = structuredClone(state.board);

  assert.throws(() => resolveTroopAction(state, 'A', 0, 1, 11), /suficientes tropas/);
  assert.deepEqual(state.board, before);
  assert.throws(() => resolveTroopAction(state, 'A', 0, 25, 1), /casillas distintas/);
});
