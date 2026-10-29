const { createServer } = require('node:http');
const express = require('express');
const path = require('node:path');
const { createGameModule } = require('./modules/game');
const { registerOverlayRoutes } = require('./modules/overlay');
const { createSseHub } = require('./modules/realtime/sseHub');
const { createTikTokModule, createTikTokMonitorService } = require('./modules/tiktok');

function createErrorHandler() {
  return (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const statusCode = error.status === 413 ? 413 : 400;
    response.status(statusCode).json({ ok: false, message: error.message || String(error) });
  };
}

function createWebserver({
  troopRegenerationIntervalMs = 1000,
  inactivityTimeoutMs = 10000,
  scheduleInactivityTimeout = setTimeout,
  cancelInactivityTimeout = clearTimeout,
  random = Math.random,
  configurationPath = process.env.WEBSERVER_CONFIG_PATH || path.join(__dirname, 'data', 'monitor-config.json'),
  gameStateService,
  warRulesService,
  monitorService = createTikTokMonitorService(),
} = {}) {
  const app = express();
  const server = createServer(app);
  const gameStream = createSseHub();
  const activityStream = createSseHub();
  const gameModule = createGameModule({
    stream: gameStream,
    troopRegenerationIntervalMs,
    inactivityTimeoutMs,
    scheduleInactivityTimeout,
    cancelInactivityTimeout,
    random,
    gameStateService,
    warRulesService,
  });
  const tiktokModule = createTikTokModule({
    stream: activityStream,
    gameStream,
    gameModule,
    monitorService,
    configurationPath,
  });

  app.use(express.json({ limit: '1mb' }));
  registerOverlayRoutes(app);
  tiktokModule.registerRoutes(app);
  gameModule.registerRoutes(app, { getMode: tiktokModule.getModePayload });

  app.get(['/backend', '/backend/', '/backend/index.html'], (request, response) => {
    response.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  app.get(['/panel', '/panel/', '/panel/index.html'], (request, response) => {
    response.redirect(308, '/backend');
  });
  app.use('/api', (request, response) => {
    response.status(404).json({ ok: false, message: 'Ruta API no encontrada.' });
  });

  app.use(createErrorHandler());

  server.on('close', () => {
    gameModule.close();
    tiktokModule.close();
    gameStream.close();
    activityStream.close();
  });

  gameModule.start();
  return { server, monitorService };
}

function startServer({
  port = Number(process.env.PORT || 80),
  host = process.env.HOST || '0.0.0.0',
  createWebserver: createServerInstance = createWebserver,
  logger = console,
} = {}) {
  const { server } = createServerInstance();
  server.listen(port, host, () => {
    const address = server.address();
    const listeningPort = address && typeof address === 'object' ? address.port : port;
    logger.log(`Servidor de juego y conector TikTok disponibles en http://localhost:${listeningPort}`);
  });
  server.on('error', (error) => {
    logger.error(`No se pudo iniciar el servidor de juego: ${error.message}`);
    process.exitCode = 1;
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { createErrorHandler, createWebserver, startServer };
