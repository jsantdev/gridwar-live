const countryIds = new Set(['A', 'B']);
const boardSize = 25;

function resolveTroopAction(gameState, teamId, sourceIndex, targetIndex, sentAmount) {
  if (!gameState || typeof gameState !== 'object' || !Array.isArray(gameState.board)
    || gameState.board.length !== boardSize) {
    throw new Error('El estado del juego debe incluir un tablero de 25 casillas.');
  }
  if (!countryIds.has(teamId)) throw new Error('El país debe ser A o B.');
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= boardSize
    || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= boardSize
    || sourceIndex === targetIndex) {
    throw new Error('El origen y el destino deben ser casillas distintas entre 0 y 24.');
  }
  if (!Number.isInteger(sentAmount) || sentAmount < 1) {
    throw new Error('La cantidad enviada debe ser un entero positivo.');
  }

  const sourceCell = gameState.board[sourceIndex];
  const targetCell = gameState.board[targetIndex];
  if (!sourceCell || sourceCell.index !== sourceIndex || !targetCell || targetCell.index !== targetIndex) {
    throw new Error('El tablero debe tener casillas indexadas de 0 a 24.');
  }
  if (sourceCell.owner !== teamId) throw new Error('La casilla de origen debe pertenecer a tu país.');
  if (!Number.isInteger(sourceCell.points) || sourceCell.points < sentAmount) {
    throw new Error('No hay suficientes tropas en la casilla de origen.');
  }
  if (!Number.isInteger(targetCell.points) || targetCell.points < 0) {
    throw new Error('Las tropas defensoras deben ser un número entero no negativo.');
  }

  const defenders = targetCell.points;
  const isNeutral = targetCell.owner == null;
  sourceCell.points -= sentAmount;
  if (sourceCell.points === 0) sourceCell.owner = null;

  let type;
  let effects;
  if (targetCell.owner === teamId) {
    targetCell.points += sentAmount;
    type = 'fortified';
    effects = ['fortified'];
  } else if (isNeutral || sentAmount > defenders) {
    targetCell.owner = teamId;
    targetCell.points = isNeutral ? sentAmount : sentAmount - defenders;
    type = 'invasion';
    effects = ['conquest'];
  } else if (sentAmount === defenders) {
    targetCell.owner = null;
    targetCell.points = 0;
    type = 'draw';
    effects = ['draw'];
  } else {
    targetCell.points = defenders - sentAmount;
    type = 'attack';
    effects = ['attack'];
  }

  return {
    type,
    source: sourceIndex,
    target: targetIndex,
    countryId: teamId,
    sent: sentAmount,
    effects,
  };
}

module.exports = { resolveTroopAction };
