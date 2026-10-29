const { createGameInteractionService } = require('./services/gameInteractionService');
const { createGameStateService } = require('./services/gameStateService');
const { createInactivityBot } = require('./services/inactivityBotService');
const { createWarRulesService } = require('./services/warRulesService');
const { registerGameRoutes } = require('./routes');

function createGameModule({
  stream,
  troopRegenerationIntervalMs = 1000,
  inactivityTimeoutMs = 10000,
  scheduleInactivityTimeout = setTimeout,
  cancelInactivityTimeout = clearTimeout,
  random = Math.random,
  gameStateService = createGameStateService(),
  warRulesService = createWarRulesService({ gameStateService }),
  getMode = () => ({ botActive: false, label: 'Conector TikTok' }),
} = {}) {
  if (!stream || typeof stream.attach !== 'function' || typeof stream.broadcast !== 'function') {
    throw new Error('El módulo del juego necesita un canal de actualizaciones.');
  }

  const interactionService = createGameInteractionService({ gameStateService, warRulesService, random });

  function broadcastUpdate(result, simulated = false) {
    stream.broadcast('update', {
      result,
      state: gameStateService.getSnapshot(),
      simulated,
    });
  }

  function executeInactivityAction(teamId) {
    try {
      const result = interactionService.runInactivityAction(teamId);
      if (result) broadcastUpdate(result, true);
    } catch (error) {
      console.error('No se pudo ejecutar la acción del bot por inactividad.', error);
    }
  }

  const inactivityBot = createInactivityBot({
    inactivityTimeoutMs,
    scheduleTimeout: scheduleInactivityTimeout,
    cancelTimeout: cancelInactivityTimeout,
    onAction: executeInactivityAction,
  });

  function noteLiveActivity(entry) {
    if (entry && typeof entry === 'object'
      && ['chat', 'gift', 'like', 'follow', 'share', 'member'].includes(entry.type)) {
      inactivityBot.reset();
    }
  }

  function handleLiveEvent(entry) {
    if (!entry || typeof entry !== 'object' || typeof entry.type !== 'string') return null;
    const result = interactionService.processLiveEvent(entry);
    if (result) broadcastUpdate(result);
    return result;
  }

  let troopRegenerationTimer = null;

  return {
    gameStateService,
    noteLiveActivity,
    handleLiveEvent,
    registerRoutes(app, { getMode: modeProvider = getMode } = {}) {
      registerGameRoutes(app, {
        gameStateService,
        interactionService,
        warRulesService,
        stream,
        broadcastUpdate,
        getMode: modeProvider,
      });
    },
    start() {
      if (troopRegenerationTimer) return;
      troopRegenerationTimer = setInterval(() => {
        const cells = gameStateService.regenerateTroops();
        if (cells.length) broadcastUpdate({ effects: ['regeneration'], cells });
      }, troopRegenerationIntervalMs);
      troopRegenerationTimer.unref();
      inactivityBot.start();
    },
    close() {
      if (troopRegenerationTimer) clearInterval(troopRegenerationTimer);
      troopRegenerationTimer = null;
      inactivityBot.stop();
    },
  };
}

module.exports = { createGameModule };
