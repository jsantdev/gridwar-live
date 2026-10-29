function createInactivityBot({
  onAction,
  inactivityTimeoutMs = 10000,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
} = {}) {
  if (typeof onAction !== 'function' || !Number.isFinite(inactivityTimeoutMs) || inactivityTimeoutMs <= 0) {
    throw new Error('El bot por inactividad requiere una acción y un tiempo positivo.');
  }

  let timer = null;
  let nextTeam = 'A';

  function schedule() {
    timer = scheduleTimeout(() => {
      timer = null;
      const teamId = nextTeam;
      nextTeam = teamId === 'A' ? 'B' : 'A';
      try {
        onAction(teamId);
      } finally {
        schedule();
      }
    }, inactivityTimeoutMs);
    timer?.unref?.();
  }

  return {
    start() {
      if (timer === null) schedule();
    },
    reset() {
      if (timer !== null) cancelTimeout(timer);
      schedule();
    },
    stop() {
      if (timer !== null) cancelTimeout(timer);
      timer = null;
    },
  };
}

module.exports = { createInactivityBot };
