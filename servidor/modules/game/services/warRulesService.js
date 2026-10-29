const countryIds = ['A', 'B'];
const maxTroops = 100;
const attritionPerCell = 2;

function createWarRulesService({ gameStateService }) {
  function adjacentCells(board, index) {
    const row = Math.floor(index / 5);
    const column = index % 5;
    return [
      row > 0 ? index - 5 : null,
      column < 4 ? index + 1 : null,
      row < 4 ? index + 5 : null,
      column > 0 ? index - 1 : null,
    ].filter((cellIndex) => cellIndex !== null).map((cellIndex) => board[cellIndex]);
  }

  function applyTroop(countryId, board, cell, actionType) {
    if (cell.owner === null) {
      cell.owner = countryId;
      cell.points = 1;
      return { type: 'claim', cell: cell.index };
    }

    if (cell.owner === countryId) {
      if (cell.points < maxTroops) {
        cell.points += 1;
        return { type: 'reinforce', cell: cell.index };
      }

      const adjacent = adjacentCells(board, cell.index)
        .filter((neighbor) => neighbor.owner !== countryId || neighbor.points < maxTroops)
        .sort((first, second) => first.points - second.points || first.index - second.index);
      if (!adjacent.length) {
        return { type: actionType === 'donation' ? 'overflow-blocked' : 'fortified', cell: cell.index };
      }
      const target = adjacent[0];
      const result = applyTroop(countryId, board, target, actionType);
      return { ...result, redirectedFrom: cell.index };
    }

    if (actionType !== 'donation') return { type: 'interaction-ignored', cell: cell.index };

    cell.points -= 1;
    if (cell.points > 0) return { type: 'attack', cell: cell.index };
    
    // Conquista limpia tras neutralizar la defensa
    cell.owner = countryId;
    cell.points = 1;
    return { type: 'conquest', cell: cell.index };
  }

  function applyMovement(countryId, cellIndex, action, troopCount, board) {
    const fromCellIndex = action.fromCellIndex;
    if (!Number.isInteger(fromCellIndex) || fromCellIndex < 0 || fromCellIndex >= 25) {
      throw new Error('La casilla de origen debe ser un número entre 0 y 24.');
    }
    if (fromCellIndex === cellIndex) throw new Error('El origen y el destino deben ser casillas distintas.');

    const origin = board[fromCellIndex];
    if (origin.owner !== countryId) throw new Error('La casilla de origen debe pertenecer a tu país.');
    if (troopCount > origin.points) throw new Error('No hay suficientes tropas en la casilla de origen.');

    const distance = Math.abs(Math.floor(cellIndex / 5) - Math.floor(fromCellIndex / 5))
      + Math.abs((cellIndex % 5) - (fromCellIndex % 5));
    
    // Desgaste logístico por distancia de traslado
    const arrivedTroops = Math.max(0, troopCount - distance * attritionPerCell);
    origin.points -= troopCount;
    if (origin.points === 0) origin.owner = null;

    const target = board[cellIndex];
    const effects = ['movement'];

    if (arrivedTroops === 0) {
      effects.push('attrition');
    } else if (target.owner === null) {
      target.owner = countryId;
      target.points = Math.min(maxTroops, arrivedTroops);
      effects.push('claim');
    } else if (target.owner === countryId) {
      target.points = Math.min(maxTroops, target.points + arrivedTroops);
      effects.push('reinforce');
    } else if (arrivedTroops > target.points) {
      target.owner = countryId;
      target.points = Math.min(maxTroops, arrivedTroops - target.points);
      effects.push('conquest');
    } else if (arrivedTroops === target.points) {
      // Regla de empate táctico: el defensor aguanta heroicamente con 1 soldado
      target.owner = target.owner; 
      target.points = 1;
      effects.push('attack', 'draw');
    } else {
      target.points -= arrivedTroops;
      effects.push('attack');
    }

    const affectedCellIndexes = [...new Set([fromCellIndex, cellIndex])].sort((first, second) => first - second);
    affectedCellIndexes.forEach((index) => {
      const cell = board[index];
      gameStateService.updateCell(index, { owner: cell.owner, points: cell.points });
    });

    return {
      countryId,
      source: fromCellIndex,
      target: cellIndex,
      type: action.type,
      distance,
      sent: troopCount,
      arrived: arrivedTroops,
      outcomes: [{ type: effects[effects.length - 1], cell: cellIndex }],
      effects,
      cells: affectedCellIndexes.map((index) => ({ ...board[index] })),
    };
  }

  function applyAction(countryId, cellIndex, action) {
    if (!countryIds.includes(countryId)) throw new Error('El país debe ser A o B.');
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= 25) {
      throw new Error('La casilla debe ser un número entre 0 y 24.');
    }
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw new Error('La acción táctica no es válida.');
    }
    if (!['donation', 'interaction', 'move'].includes(action.type)) {
      throw new Error('El tipo de acción debe ser donation, interaction o move.');
    }
    const troopCount = action.troops === undefined ? 1 : action.troops;
    if (!Number.isInteger(troopCount) || troopCount < 1 || troopCount > maxTroops) {
      throw new Error(`La cantidad de tropas debe ser un entero entre 1 y ${maxTroops}.`);
    }

    const board = gameStateService.getSnapshot().board;
    if (action.type === 'move') {
      return applyMovement(countryId, cellIndex, action, troopCount, board);
    }

    const outcomes = [];
    for (let troop = 0; troop < troopCount; troop += 1) {
      outcomes.push(applyTroop(countryId, board, board[cellIndex], action.type));
    }
    const affectedCellIndexes = new Set(outcomes.flatMap((outcome) => [outcome.cell, outcome.redirectedFrom]
      .filter((index) => index !== undefined)));
    affectedCellIndexes.forEach((index) => {
      const cell = board[index];
      gameStateService.updateCell(index, { owner: cell.owner, points: cell.points });
    });

    const effects = new Set(outcomes.map((outcome) => outcome.type));
    if (outcomes.some((outcome) => outcome.redirectedFrom !== undefined)) effects.add('fortified');
    return {
      countryId,
      target: cellIndex,
      type: action.type,
      outcomes,
      effects: [...effects],
      cells: [...affectedCellIndexes].sort((first, second) => first - second).map((index) => ({ ...board[index] })),
    };
  }

  function advanceFront(countryId, advances = 1) {
    if (!countryIds.includes(countryId)) throw new Error('El país debe ser A o B.');
    if (!Number.isInteger(advances) || advances < 1 || advances > 100) {
      throw new Error('La cantidad de avances debe ser un entero entre 1 y 100.');
    }

    const movements = [];
    for (let advance = 0; advance < advances; advance += 1) {
      const { countries, board, winner } = gameStateService.getSnapshot();
      if (winner) break;
      const ownCapital = countries.find((country) => country.id === countryId).capitalCell;
      const enemyCapital = countries.find((country) => country.id !== countryId).capitalCell;
      const distanceToEnemy = (index) => Math.abs(Math.floor(index / 5) - Math.floor(enemyCapital / 5))
        + Math.abs((index % 5) - (enemyCapital % 5));
      const distanceFromOwnCapital = (index) => Math.abs(Math.floor(index / 5) - Math.floor(ownCapital / 5))
        + Math.abs((index % 5) - (ownCapital % 5));
      const isOnInvasionRoute = (index) => (
        distanceFromOwnCapital(index) + distanceToEnemy(index) === distanceFromOwnCapital(enemyCapital)
      );
      const possibleMoves = [];

      board.forEach((source) => {
        if (source.owner !== countryId || source.points <= attritionPerCell + 1 || !isOnInvasionRoute(source.index)) return;
        adjacentCells(board, source.index).forEach((target) => {
          if ((target.owner === countryId && target.points >= maxTroops) || !isOnInvasionRoute(target.index)
            || distanceToEnemy(target.index) >= distanceToEnemy(source.index)) return;
          possibleMoves.push({ source, target });
        });
      });

      possibleMoves.sort((first, second) => distanceToEnemy(first.target.index) - distanceToEnemy(second.target.index)
        || Number(second.target.owner !== null) - Number(first.target.owner !== null)
        || distanceToEnemy(first.source.index) - distanceToEnemy(second.source.index)
        || second.source.points - first.source.points
        || first.target.index - second.target.index);
      if (!possibleMoves.length) break;

      const { source, target } = possibleMoves[0];
      movements.push(applyMovement(countryId, target.index, {
        type: 'move',
        fromCellIndex: source.index,
      }, attritionPerCell + 1, board));
    }

    const affectedCells = new Map();
    movements.forEach((movement) => movement.cells.forEach((cell) => affectedCells.set(cell.index, cell)));
    return {
      countryId,
      type: 'automatic-advance',
      advances: movements.length,
      outcomes: movements,
      effects: movements.length
        ? [...new Set(movements.flatMap((movement) => movement.effects))]
        : ['no-path'],
      cells: [...affectedCells.values()].sort((first, second) => first.index - second.index),
      winner: gameStateService.getSnapshot().winner,
    };
  }

  return { applyAction, advanceFront };
}

module.exports = { createWarRulesService };