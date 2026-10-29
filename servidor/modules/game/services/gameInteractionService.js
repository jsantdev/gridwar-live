const { resolveTroopAction } = require('./troopActionService');

function createGameInteractionService({ gameStateService, warRulesService, random = Math.random } = {}) {
  if (!gameStateService || typeof gameStateService.getSnapshot !== 'function'
    || !warRulesService || typeof warRulesService.advanceFront !== 'function'
    || typeof random !== 'function') {
    throw new Error('El motor de interacciones requiere servicios de estado y reglas válidos.');
  }

  let accumulatedLikes = 0;

  function adjacentIndexes(index) {
    const row = Math.floor(index / 5);
    const column = index % 5;
    return [
      row > 0 ? index - 5 : null,
      column < 4 ? index + 1 : null,
      row < 4 ? index + 5 : null,
      column > 0 ? index - 1 : null,
    ].filter((cellIndex) => cellIndex !== null);
  }

  function resolveAndApplyTroopAction(teamId, sourceIndex, targetIndex, sentAmount) {
    const workingState = gameStateService.getSnapshot();
    const result = resolveTroopAction(workingState, teamId, sourceIndex, targetIndex, sentAmount);
    const updatedCells = [workingState.board[sourceIndex], workingState.board[targetIndex]];
    if (updatedCells.some((cell) => cell.points > 100)) {
      throw new Error('Una casilla no puede tener más de 100 tropas.');
    }
    updatedCells.forEach((cell) => gameStateService.updateCell(cell.index, {
      owner: cell.owner,
      points: cell.points,
    }));
    return result;
  }

  function runInactivityAction(teamId) {
    const snapshot = gameStateService.getSnapshot();
    const actionType = ['attack', 'mobilization', 'reinforcement'][Math.floor(random() * 3)];
    const sources = snapshot.board.filter((cell) => cell.owner === teamId && cell.points > 1);
    const pairs = [];

    sources.forEach((source) => adjacentIndexes(source.index).forEach((targetIndex) => {
      const target = snapshot.board[targetIndex];
      const isFriendly = target.owner === teamId;
      if (actionType === 'attack' && !isFriendly) pairs.push({ source, target });
      if (actionType === 'mobilization'
        && (target.owner === null || (isFriendly && target.points < 100))) {
        pairs.push({ source, target });
      }
      if (actionType === 'reinforcement' && isFriendly && target.points < 100) {
        pairs.push({ source, target });
      }
    }));

    if (!pairs.length) {
      sources.forEach((source) => adjacentIndexes(source.index).forEach((targetIndex) => {
        const target = snapshot.board[targetIndex];
        if (target.owner !== teamId || target.points < 100) pairs.push({ source, target });
      }));
    }
    if (!pairs.length) return null;

    const pair = pairs[Math.floor(random() * pairs.length)];
    const room = pair.target.owner === teamId ? 100 - pair.target.points : 100;
    const sentAmount = Math.min(3, pair.source.points, room);
    if (sentAmount < 1) return null;

    const result = resolveAndApplyTroopAction(teamId, pair.source.index, pair.target.index, sentAmount);
    result.actionType = actionType;
    result.effects = [...new Set([...result.effects, 'movement'])];
    return result;
  }

  function processLiveEvent(entry) {
    const acceptedTypes = ['chat', 'gift', 'like', 'follow', 'share', 'member'];
    if (!entry || !acceptedTypes.includes(entry.type)) return null;

    const countryId = gameStateService.assignCountryToUser(entry.username || 'Espectador');
    const count = Number.isInteger(entry.activityCount) && entry.activityCount > 0
      ? Math.min(entry.activityCount, 100)
      : 1;
    const isGift = entry.type === 'gift';
    const diamondCount = isGift
      ? (Number.isInteger(entry.diamondCount) && entry.diamondCount > 0 ? entry.diamondCount * count : count)
      : 0;
    gameStateService.recordMemberActivity(countryId, {
      username: entry.username || 'Espectador',
      donations: diamondCount,
      interactions: isGift ? 0 : count,
    });

    let result;
    if (isGift) {
      const snapshot = gameStateService.getSnapshot();
      const sources = snapshot.board.filter((cell) => cell.owner === countryId && cell.points > 0);
      const pairs = [];
      sources.forEach((source) => adjacentIndexes(source.index).forEach((targetIndex) => {
        const target = snapshot.board[targetIndex];
        if (target.owner === countryId && target.points < 100) {
          pairs.push({
            source,
            target,
            preference: diamondCount >= 100 && target.capitalFor === countryId ? 0 : 1,
          });
        } else if (target.owner !== countryId) {
          pairs.push({ source, target, preference: target.owner ? 3 : 2 });
        }
      }));
      pairs.sort((first, second) => first.preference - second.preference);

      if (pairs.length) {
        const preferred = pairs.filter((pair) => pair.preference === pairs[0].preference);
        const pair = preferred[Math.floor(random() * preferred.length)];
        const targetOwner = pair.target.owner;
        const room = targetOwner === countryId ? 100 - pair.target.points : 100;
        const sentAmount = Math.min(
          pair.source.points,
          room,
          diamondCount >= 100 ? 100 : Math.max(1, Math.min(10, diamondCount)),
        );
        if (sentAmount > 0) {
          result = resolveAndApplyTroopAction(countryId, pair.source.index, pair.target.index, sentAmount);
          result.actionType = targetOwner === countryId
            ? 'reinforcement'
            : diamondCount >= 100 ? 'invasion' : targetOwner === null ? 'mobilization' : 'attack';
          result.effects = [...new Set([...result.effects, 'movement'])];
        }
      }
    } else if (entry.type === 'chat') {
      result = warRulesService.advanceFront(countryId, 1);
    } else if (entry.type === 'like') {
      const totalLikes = accumulatedLikes + count;
      const advances = Math.floor(totalLikes / 10);
      accumulatedLikes = totalLikes % 10;
      if (advances) result = warRulesService.advanceFront(countryId, advances);
    }

    if (!result) {
      result = { type: 'activity', countryId, source: null, target: null, sent: 0, effects: [] };
    }
    result.trigger = entry.type;
    result.username = entry.username || 'Espectador';
    return result;
  }

  return {
    processLiveEvent,
    resolveAndApplyTroopAction,
    runInactivityAction,
  };
}

module.exports = { createGameInteractionService };
