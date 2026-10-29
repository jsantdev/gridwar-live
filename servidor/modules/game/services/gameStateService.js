const countryIds = ['A', 'B'];
const leaderRanks = ['Rey / Líder Supremo', 'General', 'Capitán'];
const maxCellTroops = 100;

function createGameStateService({ random = Math.random } = {}) {
  if (typeof random !== 'function') throw new Error('El generador aleatorio debe ser una función.');

  const cellIndexes = Array.from({ length: 25 }, (_, index) => index);
  for (let index = cellIndexes.length - 1; index > 0; index -= 1) {
    const value = random();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error('El generador aleatorio debe devolver un número entre 0 y 1.');
    }
    const swapIndex = Math.floor(value * (index + 1));
    [cellIndexes[index], cellIndexes[swapIndex]] = [cellIndexes[swapIndex], cellIndexes[index]];
  }
  const capitalIndexes = { A: cellIndexes[0], B: cellIndexes[1] };
  let activeCountryId = null;
  const userCountries = new Map();
  const assignedUsersByCountry = new Map(countryIds.map((id) => [id, 0]));
  const countries = new Map(countryIds.map((id) => [id, {
    id,
    name: `País ${id}`,
    capital: '',
    capitalCell: capitalIndexes[id],
    points: 0,
    morale: 100,
  }]));
  const board = Array.from({ length: 25 }, (_, index) => ({
    index,
    owner: null,
    points: 0,
    capitalFor: null,
  }));
  countryIds.forEach((id) => {
    const cell = board[capitalIndexes[id]];
    cell.owner = id;
    cell.points = maxCellTroops;
    cell.capitalFor = id;
  });
  const members = new Map(countryIds.map((id) => [id, new Map()]));
  function getCountry(countryId) {
    if (!countries.has(countryId)) throw new Error('El país debe ser A o B.');
    return countries.get(countryId);
  }

  function nonNegativeNumber(value, field) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${field} debe ser un número mayor o igual a cero.`);
    }
    return value;
  }

  function getLeaders(countryId) {
    getCountry(countryId);
    return [...members.get(countryId).values()]
      .sort((first, second) => (second.donations + second.interactions) - (first.donations + first.interactions)
        || second.donations - first.donations
        || first.username.localeCompare(second.username))
      .slice(0, 3)
      .map((member, index) => ({
        ...member,
        score: member.donations + member.interactions,
        rank: leaderRanks[index],
      }));
  }

  function getSnapshot() {
    const winner = countryIds
      .map((capitalCountryId) => ({
        capitalCountryId,
        owner: board[capitalIndexes[capitalCountryId]].owner,
      }))
      .find(({ capitalCountryId, owner }) => owner && owner !== capitalCountryId);
    return {
      countries: countryIds.map((id) => ({ ...countries.get(id) })),
      board: board.map((cell) => ({ ...cell })),
      leaders: Object.fromEntries(countryIds.map((id) => [id, getLeaders(id)])),
      activeCountryId,
      winner: winner ? winner.owner : null,
    };
  }

  function assignCountryToUser(username) {
    if (typeof username !== 'string' || !username.trim()) throw new Error('El usuario es obligatorio.');
    const normalizedUsername = username.trim().replace(/^@+/, '');
    if (!normalizedUsername) throw new Error('El usuario es obligatorio.');
    const key = normalizedUsername.toLocaleLowerCase();
    let countryId = userCountries.get(key);
    if (!countryId) {
      countryId = assignedUsersByCountry.get('A') <= assignedUsersByCountry.get('B') ? 'A' : 'B';
      userCountries.set(key, countryId);
      assignedUsersByCountry.set(countryId, assignedUsersByCountry.get(countryId) + 1);
    }
    activeCountryId = countryId;
    return countryId;
  }

  function updateCountry(countryId, changes) {
    const country = getCountry(countryId);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new Error('Los datos del país no son válidos.');
    }
    let name = country.name;
    let capital = country.capital;
    if (Object.hasOwn(changes, 'name')) {
      if (typeof changes.name !== 'string' || !changes.name.trim()) throw new Error('El nombre del país es obligatorio.');
      name = changes.name.trim();
    }
    if (Object.hasOwn(changes, 'capital')) {
      if (typeof changes.capital !== 'string') throw new Error('La capital debe ser texto.');
      capital = changes.capital.trim();
    }
    country.name = name;
    country.capital = capital;
    return { ...country };
  }

  function addCountryPoints(countryId, delta) {
    const country = getCountry(countryId);
    if (typeof delta !== 'number' || !Number.isFinite(delta)) throw new Error('El cambio de puntos debe ser un número.');
    const nextPoints = country.points + delta;
    if (!Number.isFinite(nextPoints)) throw new Error('El total de puntos debe ser un número finito.');
    if (nextPoints < 0) throw new Error('Los puntos del país no pueden quedar por debajo de cero.');
    country.points = nextPoints;
    return { ...country };
  }

  function changeMorale(countryId, delta) {
    const country = getCountry(countryId);
    if (typeof delta !== 'number' || !Number.isFinite(delta)) throw new Error('El cambio de moral debe ser un número.');
    country.morale = Math.max(0, Math.min(100, country.morale + delta));
    return { ...country };
  }

  function updateCell(index, changes) {
    if (!Number.isInteger(index) || index < 0 || index >= board.length) {
      throw new Error('La casilla debe ser un número entre 0 y 24.');
    }
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new Error('Los datos de la casilla no son válidos.');
    }
    const cell = board[index];
    if (Object.hasOwn(changes, 'owner')) {
      if (changes.owner !== null && !countryIds.includes(changes.owner)) {
        throw new Error('El dueño de la casilla debe ser A, B o null.');
      }
    }
    const owner = Object.hasOwn(changes, 'owner') ? changes.owner : cell.owner;
    const points = Object.hasOwn(changes, 'points')
      ? nonNegativeNumber(changes.points, 'Los puntos de la casilla')
      : cell.points;
    if (points > maxCellTroops) throw new Error(`Una casilla no puede tener más de ${maxCellTroops} tropas.`);
    if ((owner === null && points !== 0) || (owner !== null && points === 0)) {
      throw new Error('Las casillas neutrales deben tener cero tropas y las ocupadas al menos una.');
    }
    cell.owner = owner;
    cell.points = points;
    return { ...cell };
  }

  function regenerateTroops() {
    const changedCells = [];
    board.forEach((cell) => {
      if (!cell.owner || cell.points >= maxCellTroops || countries.get(cell.owner).morale < 70) return;
      cell.points = Math.min(maxCellTroops, cell.points + 3);
      changedCells.push({ ...cell });
    });
    return changedCells;
  }

  function recordMemberActivity(countryId, activity) {
    getCountry(countryId);
    if (!activity || typeof activity !== 'object' || Array.isArray(activity)
      || typeof activity.username !== 'string' || !activity.username.trim()) {
      throw new Error('El usuario es obligatorio.');
    }
    const username = activity.username.trim().replace(/^@+/, '');
    if (!username) throw new Error('El usuario es obligatorio.');
    const donations = activity.donations === undefined ? 0 : nonNegativeNumber(activity.donations, 'Las donaciones');
    const interactions = activity.interactions === undefined ? 0 : nonNegativeNumber(activity.interactions, 'Las interacciones');
    if (donations === 0 && interactions === 0) throw new Error('Debes registrar una donación o una interacción.');

    const countryMembers = members.get(countryId);
    const key = username.toLocaleLowerCase();
    const existing = countryMembers.get(key) || { username, donations: 0, interactions: 0 };
    const nextDonations = existing.donations + donations;
    const nextInteractions = existing.interactions + interactions;
    if (!Number.isFinite(nextDonations + nextInteractions)) {
      throw new Error('La puntuación acumulada debe ser un número finito.');
    }
    existing.donations = nextDonations;
    existing.interactions = nextInteractions;
    countryMembers.set(key, existing);
    return getLeaders(countryId);
  }

  return {
    countryIds: [...countryIds],
    getSnapshot,
    assignCountryToUser,
    updateCountry,
    addCountryPoints,
    changeMorale,
    updateCell,
    regenerateTroops,
    recordMemberActivity,
  };
}

module.exports = { createGameStateService };
