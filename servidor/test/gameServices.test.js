const assert = require('node:assert/strict');
const test = require('node:test');

const { createGameStateService } = require('../modules/game/services/gameStateService');
const { createWarRulesService } = require('../modules/game/services/warRulesService');

test('game state service rejects invalid country, points, morale, and cell changes', () => {
  const game = createGameStateService();
  const initialCell = game.getSnapshot().board[0];

  assert.throws(() => game.updateCountry('C', {}), /país debe ser A o B/);
  assert.throws(() => game.updateCountry('A', null), /datos del país/);
  assert.throws(() => game.updateCountry('A', []), /datos del país/);
  assert.throws(() => game.updateCountry('A', { name: '  ' }), /nombre del país/);
  assert.throws(() => game.updateCountry('A', { capital: 10 }), /capital debe ser texto/);
  assert.throws(() => game.addCountryPoints('A', '1'), /cambio de puntos/);
  assert.throws(() => game.changeMorale('A', Infinity), /cambio de moral/);
  assert.throws(() => game.updateCell(-1, {}), /entre 0 y 24/);
  assert.throws(() => game.updateCell(1.5, {}), /entre 0 y 24/);
  assert.throws(() => game.updateCell(0, null), /datos de la casilla/);
  assert.throws(() => game.updateCell(0, []), /datos de la casilla/);
  assert.throws(() => game.updateCell(0, { owner: 'C' }), /dueño de la casilla/);
  assert.throws(() => game.updateCell(0, { points: -1 }), /mayor o igual a cero/);
  assert.throws(() => game.updateCell(0, { owner: 'A', points: 101 }), /más de 100 tropas/);
  assert.throws(() => game.updateCell(0, { owner: null, points: 1 }), /neutrales deben tener cero/);
  assert.throws(() => game.updateCell(0, { owner: 'A', points: 0 }), /ocupadas al menos una/);
  assert.deepEqual(game.getSnapshot().board[0], initialCell);
});

test('member activity validates, normalizes usernames, and prevents accumulated overflow', () => {
  const game = createGameStateService();

  assert.throws(() => game.recordMemberActivity('C', { username: 'ana', interactions: 1 }), /país debe ser A o B/);
  assert.throws(() => game.recordMemberActivity('A', null), /usuario es obligatorio/);
  assert.throws(() => game.recordMemberActivity('A', { username: ' @ ' }), /usuario es obligatorio/);
  assert.throws(() => game.recordMemberActivity('A', { username: 'ana' }), /registrar una donación/);
  assert.throws(() => game.recordMemberActivity('A', { username: 'ana', donations: -1 }), /donaciones.*mayor o igual/);
  assert.throws(() => game.recordMemberActivity('A', { username: 'ana', interactions: NaN }), /interacciones.*mayor o igual/);

  game.recordMemberActivity('A', { username: '@@Ana', interactions: 2 });
  assert.equal(game.getSnapshot().leaders.A[0].username, 'Ana');
  assert.throws(
    () => {
      game.recordMemberActivity('A', { username: 'overflow', donations: Number.MAX_VALUE });
      game.recordMemberActivity('A', { username: 'overflow', donations: Number.MAX_VALUE });
    },
    /puntuación acumulada/,
  );
  const leaders = game.getSnapshot().leaders.A;
  assert.equal(leaders.find((leader) => leader.username === 'Ana').score, 2);
  assert.equal(leaders.find((leader) => leader.username === 'overflow').score, Number.MAX_VALUE);
});

test('war rules validates action inputs and reports fortified overflow when no adjacent cell can grow', () => {
  const game = createGameStateService({ random: () => 0 });
  const war = createWarRulesService({ gameStateService: game });

  assert.throws(() => war.applyAction('C', 0, { type: 'interaction' }), /país debe ser A o B/);
  assert.throws(() => war.applyAction('A', 25, { type: 'interaction' }), /entre 0 y 24/);
  assert.throws(() => war.applyAction('A', 0, null), /acción táctica no es válida/);
  assert.throws(() => war.applyAction('A', 0, { type: 'share' }), /debe ser donation, interaction o move/);
  assert.throws(() => war.applyAction('A', 0, { type: 'donation', troops: 101 }), /entre 1 y 100/);

  for (let index = 0; index < 25; index += 1) {
    game.updateCell(index, { owner: 'A', points: 100 });
  }
  const interaction = war.applyAction('A', 12, { type: 'interaction' });
  assert.deepEqual(interaction.effects, ['fortified']);
  const donation = war.applyAction('A', 12, { type: 'donation' });
  assert.deepEqual(donation.effects, ['overflow-blocked']);
  assert.deepEqual(donation.cells, [{ index: 12, owner: 'A', points: 100, capitalFor: null }]);
});

test('capitals start on distinct random cells and high-morale territories regenerate troops', () => {
  const game = createGameStateService({ random: () => 0 });
  const { countries, board } = game.getSnapshot();

  assert.notEqual(countries[0].capitalCell, countries[1].capitalCell);
  assert.deepEqual(countries.map((country) => board[country.capitalCell]), [
    { index: countries[0].capitalCell, owner: 'A', points: 100, capitalFor: 'A' },
    { index: countries[1].capitalCell, owner: 'B', points: 100, capitalFor: 'B' },
  ]);
  game.updateCell(10, { owner: 'A', points: 99 });
  game.updateCell(11, { owner: 'B', points: 50 });
  game.changeMorale('B', -30);

  assert.deepEqual(game.regenerateTroops(), [
    { index: 10, owner: 'A', points: 100, capitalFor: null },
    { index: 11, owner: 'B', points: 53, capitalFor: null },
  ]);
  game.changeMorale('B', -1);
  game.updateCell(11, { owner: 'B', points: 99 });
  assert.deepEqual(game.regenerateTroops(), []);
  assert.equal(game.getSnapshot().board[11].points, 99);
});

test('interactions redirect reinforcement from a full cell to a weaker adjacent cell', () => {
  const game = createGameStateService({ random: () => 0 });
  const war = createWarRulesService({ gameStateService: game });
  game.updateCell(0, { owner: 'A', points: 100 });

  const result = war.applyAction('A', 0, { type: 'interaction' });

  assert.deepEqual(result.effects, ['claim', 'fortified']);
  assert.deepEqual(result.cells, [
    { index: 0, owner: 'A', points: 100, capitalFor: null },
    { index: 5, owner: 'A', points: 1, capitalFor: null },
  ]);
});

test('movement applies Manhattan attrition and conquers with surviving troops', () => {
  const game = createGameStateService({ random: () => 0 });
  const war = createWarRulesService({ gameStateService: game });
  game.updateCell(0, { owner: 'A', points: 20 });
  game.updateCell(7, { owner: 'B', points: 4 });

  const result = war.applyAction('A', 7, { type: 'move', fromCellIndex: 0, troops: 11 });

  assert.equal(result.distance, 3);
  assert.equal(result.sent, 11);
  assert.equal(result.arrived, 5);
  assert.deepEqual(result.effects, ['movement', 'conquest']);
  assert.deepEqual(game.getSnapshot().board[0], { index: 0, owner: 'A', points: 9, capitalFor: null });
  assert.deepEqual(game.getSnapshot().board[7], { index: 7, owner: 'A', points: 1, capitalFor: null });
});

test('TikTok users are automatically and evenly assigned to countries driving the invasion', () => {
  const game = createGameStateService({ random: () => 0 });
  const war = createWarRulesService({ gameStateService: game });

  assert.equal(game.getSnapshot().activeCountryId, null);
  assert.equal(game.assignCountryToUser('Ana'), 'A');
  assert.equal(game.assignCountryToUser('Beto'), 'B');
  assert.equal(game.assignCountryToUser('@ana'), 'A');
  const result = war.advanceFront('A');

  assert.equal(result.advances, 1);
  assert.deepEqual(result.effects, ['movement', 'attack']);
  assert.equal(result.outcomes[0].source, 1);
  assert.equal(result.outcomes[0].target, 2);
  assert.equal(result.outcomes[0].sent, 3);
  assert.deepEqual(game.getSnapshot().board[1], { index: 1, owner: 'A', points: 97, capitalFor: 'A' });
  assert.deepEqual(game.getSnapshot().board[2], { index: 2, owner: 'B', points: 99, capitalFor: 'B' });
  game.updateCell(2, { owner: 'A', points: 1 });
  assert.equal(game.getSnapshot().winner, 'A');
  assert.equal(war.advanceFront('A').advances, 0);
  assert.throws(() => game.assignCountryToUser(' @ '), /usuario es obligatorio/);
});
