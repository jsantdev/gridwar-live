function registerGameRoutes(app, {
  gameStateService,
  interactionService,
  warRulesService,
  stream,
  broadcastUpdate,
  getMode,
}) {
  app.get('/api/game-state', (request, response) => {
    response.json(gameStateService.getSnapshot());
  });

  app.get('/api/game-state/stream', (request, response) => {
    stream.attach(response, [
      ['snapshot', gameStateService.getSnapshot()],
      ['mode', getMode()],
    ]);
  });

  app.param('countryId', (request, response, next, countryId) => {
    if (!['A', 'B'].includes(countryId)) {
      response.status(404).json({ ok: false, message: 'País no encontrado.' });
      return;
    }
    next();
  });

  app.patch('/api/game-state/countries/:countryId', (request, response) => {
    const result = gameStateService.updateCountry(request.params.countryId, request.body);
    broadcastUpdate(result);
    response.json({ ok: true, result, state: gameStateService.getSnapshot() });
  });

  app.post('/api/game-state/countries/:countryId/points', (request, response) => {
    const result = gameStateService.addCountryPoints(request.params.countryId, request.body.delta);
    broadcastUpdate(result);
    response.json({ ok: true, result, state: gameStateService.getSnapshot() });
  });

  app.post('/api/game-state/countries/:countryId/morale', (request, response) => {
    const result = gameStateService.changeMorale(request.params.countryId, request.body.delta);
    broadcastUpdate(result);
    response.json({ ok: true, result, state: gameStateService.getSnapshot() });
  });

  app.post('/api/game-state/countries/:countryId/members', (request, response) => {
    const result = gameStateService.recordMemberActivity(request.params.countryId, request.body);
    broadcastUpdate({ type: 'activity', countryId: request.params.countryId, effects: [] });
    response.json({ ok: true, result, state: gameStateService.getSnapshot() });
  });

  app.put('/api/game-state/board/:index', (request, response) => {
    const result = gameStateService.updateCell(Number(request.params.index), request.body);
    broadcastUpdate(result);
    response.json({ ok: true, result, state: gameStateService.getSnapshot() });
  });

  app.post('/api/game-state/actions', (request, response) => {
    const action = request.body;
    let result;
    if (action.type === 'troop') {
      result = interactionService.resolveAndApplyTroopAction(
        action.teamId,
        action.sourceIndex,
        action.targetIndex,
        action.sentAmount,
      );
      result.actionType = 'mobilization';
      result.effects = [...new Set([...result.effects, 'movement'])];
    } else {
      result = warRulesService.applyAction(action.countryId, action.cellIndex, action);
    }
    broadcastUpdate(result);
    response.json({ ok: true, result, state: gameStateService.getSnapshot() });
  });
}

module.exports = { registerGameRoutes };
