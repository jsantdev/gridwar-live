const test = require('node:test');
const assert = require('node:assert/strict');
const { createInactivityBot } = require('../modules/game/services/inactivityBotService');

function createFakeTimers() {
  let nextId = 0;
  const timers = new Map();
  return {
    timers,
    scheduleTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, delay });
      return id;
    },
    cancelTimeout(id) {
      timers.delete(id);
    },
    fireNext() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
  };
}

test('inactivity bot restarts its ten-second timer and alternates teams', () => {
  const fakeTimers = createFakeTimers();
  const teams = [];
  const bot = createInactivityBot({
    onAction: (teamId) => teams.push(teamId),
    inactivityTimeoutMs: 10000,
    scheduleTimeout: fakeTimers.scheduleTimeout,
    cancelTimeout: fakeTimers.cancelTimeout,
  });

  bot.start();
  assert.equal([...fakeTimers.timers.values()][0].delay, 10000);
  bot.reset();
  assert.equal(fakeTimers.timers.size, 1);
  fakeTimers.fireNext();
  fakeTimers.fireNext();
  assert.deepEqual(teams, ['A', 'B']);
  bot.stop();
  assert.equal(fakeTimers.timers.size, 0);
});
