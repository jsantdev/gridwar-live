const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const express = require('express');
const { createGameModule } = require('../modules/game');
const { createSseHub } = require('../modules/realtime/sseHub');
const { createErrorHandler, startServer } = require('../server');

function createFakeTimers() {
  const timers = new Map();
  let nextId = 0;
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

function createResponse() {
  const response = new EventEmitter();
  response.messages = [];
  response.writableEnded = false;
  response.destroyed = false;
  response.writeHead = (status, headers) => {
    response.status = status;
    response.headers = headers;
  };
  response.flushHeaders = () => { response.flushed = true; };
  response.write = (message) => response.messages.push(message);
  response.end = () => { response.writableEnded = true; };
  return response;
}

test('SSE hub attaches snapshots, broadcasts, removes closed clients, and shuts down', () => {
  const stream = createSseHub();
  const first = createResponse();
  const second = createResponse();
  stream.attach(first, [['snapshot', { value: 1 }]]);
  stream.attach(second);
  assert.equal(first.status, 200);
  assert.equal(first.flushed, true);
  assert.match(first.messages[0], /event: snapshot/);

  first.destroyed = true;
  stream.broadcast('update', { value: 2 });
  assert.equal(second.messages.length, 1);
  assert.match(second.messages[0], /event: update/);
  const third = createResponse();
  stream.attach(third);
  third.writableEnded = true;
  stream.broadcast('status', {});
  assert.equal(third.messages.length, 0);
  assert.equal(second.messages.length, 2);

  second.emit('close');
  stream.broadcast('after-close', {});
  assert.equal(second.messages.length, 2);
  const last = createResponse();
  stream.attach(last);
  stream.close();
  assert.equal(last.writableEnded, true);
});

test('shared API error handler formats client errors and delegates after headers are sent', () => {
  const handleError = createErrorHandler();
  const response = {
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
    },
  };
  handleError({ status: 413, message: 'large request' }, {}, response, assert.fail);
  assert.equal(response.statusCode, 413);
  assert.equal(response.payload.message, 'large request');

  handleError('invalid request', {}, response, assert.fail);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.message, 'invalid request');

  const forwarded = [];
  response.headersSent = true;
  const error = new Error('after headers');
  handleError(error, {}, response, (received) => forwarded.push(received));
  assert.deepEqual(forwarded, [error]);
});

test('startServer reports its address, falls back to requested port, and handles listen errors', () => {
  const messages = [];
  class FakeServer extends EventEmitter {
    constructor(address) {
      super();
      this.addressValue = address;
    }

    listen(port, host, callback) {
      this.port = port;
      this.host = host;
      if (!this.shouldFail) callback();
    }

    address() {
      return this.addressValue;
    }
  }
  const factory = (server) => () => ({ server });
  const first = new FakeServer({ port: 4321 });
  startServer({
    port: 80,
    host: '127.0.0.1',
    createWebserver: factory(first),
    logger: { log: (message) => messages.push(message), error: assert.fail },
  });
  assert.equal(first.port, 80);
  assert.match(messages[0], /4321/);

  const second = new FakeServer(null);
  startServer({
    port: 8081,
    createWebserver: factory(second),
    logger: { log: (message) => messages.push(message), error: assert.fail },
  });
  assert.match(messages[1], /8081/);

  const third = new FakeServer(null);
  third.shouldFail = true;
  const previousExitCode = process.exitCode;
  const errors = [];
  startServer({
    createWebserver: factory(third),
    logger: { log: assert.fail, error: (message) => errors.push(message) },
  });
  third.emit('error', new Error('port busy'));
  assert.equal(process.exitCode, 1);
  assert.match(errors[0], /port busy/);
  process.exitCode = previousExitCode;
});

test('game module lifecycle is idempotent and reports invalid bot action failures', () => {
  const stream = createSseHub();
  const timers = createFakeTimers();
  assert.throws(() => createGameModule(), /canal de actualizaciones/);

  const game = createGameModule({
    stream,
    troopRegenerationIntervalMs: 100000,
    inactivityTimeoutMs: 10,
    scheduleInactivityTimeout: timers.schedule,
    cancelInactivityTimeout: timers.cancel,
    random: () => 1,
  });
  game.registerRoutes(express());
  game.start();
  game.start();
  assert.equal(timers.timers.size, 1);

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    timers.fire();
  } finally {
    console.error = originalError;
  }
  assert.equal(errors.length, 1);
  game.close();
  game.close();
  assert.equal(timers.timers.size, 0);
  stream.close();
});
