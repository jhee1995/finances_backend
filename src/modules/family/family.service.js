const familyRepo = require('./family.repository');

// In-memory micro-cache for high-throughput resilience (2.5s TTL)
const familyCache = new Map();
const CACHE_TTL_MS = 2500;

function invalidateCache() {
  familyCache.clear();
}

class ValidationError extends Error {
  constructor(message = 'Error de validación', invalidParams = []) {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
    this.invalid_params = invalidParams;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Recurso no encontrado') {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

class ConflictError extends Error {
  constructor(message = 'Conflicto de estado') {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
  }
}

/**
 * Format member record into contract representation
 */
function formatMember(m) {
  return {
    id: parseInt(m.id, 10),
    name: m.name || `${m.first_name || ''} ${m.last_name || ''}`.trim(),
    email: m.email,
    is_admin: Boolean(m.is_admin)
  };
}

/**
 * Create a new family core and associate admin user
 * @param {{ family_name: string, admin_user_id: number }} data 
 */
async function createFamily(data) {
  const adminUser = await familyRepo.getUserById(data.admin_user_id);
  if (!adminUser) {
    throw new ValidationError('El usuario administrador especificado no existe', [
      { name: 'admin_user_id', reason: `El usuario con ID ${data.admin_user_id} no existe en finances.users` }
    ]);
  }

  if (adminUser.family_core) {
    throw new ConflictError('El usuario administrador ya pertenece a un núcleo familiar activo');
  }

  invalidateCache();
  const created = await familyRepo.createFamilyCore(data);
  const members = await familyRepo.getFamilyMembers(created.id);

  return {
    id: parseInt(created.id, 10),
    family_name: created.family_name,
    admin_user_id: parseInt(created.admin_user_id, 10),
    created_at: created.created_at,
    updated_at: created.updated_at || null,
    members: members.map(formatMember)
  };
}

/**
 * Get family core by ID with members list
 * @param {number} id 
 */
async function getFamilyById(id) {
  const cacheKey = `family:${id}`;
  const cached = familyCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const family = await familyRepo.getFamilyById(id);
  if (!family) {
    throw new NotFoundError(`No se encontró ningún núcleo familiar con ID ${id}`);
  }

  const members = await familyRepo.getFamilyMembers(id);

  const result = {
    id: parseInt(family.id, 10),
    family_name: family.family_name,
    admin_user_id: parseInt(family.admin_user_id, 10),
    created_at: family.created_at,
    updated_at: family.updated_at || null,
    members: members.map(formatMember)
  };

  familyCache.set(cacheKey, { timestamp: now, data: result });
  return result;
}

/**
 * Get family status and data for a specific user ID
 * @param {number} userId 
 */
async function getFamilyByUserId(userId) {
  const user = await familyRepo.getUserById(userId);
  if (!user) {
    throw new NotFoundError(`No se encontró ningún usuario con ID ${userId}`);
  }

  if (!user.family_core) {
    return {
      in_family: false,
      is_admin: false,
      family: null
    };
  }

  const family = await getFamilyById(user.family_core);
  return {
    in_family: true,
    is_admin: Number(user.id) === Number(family.admin_user_id),
    family
  };
}

/**
 * Add a member to family core by email or user ID
 * @param {number} familyId 
 * @param {{ email?: string, user_id?: number }} memberData 
 */
async function addMember(familyId, memberData) {
  const family = await familyRepo.getFamilyById(familyId);
  if (!family) {
    throw new NotFoundError(`No se encontró ningún núcleo familiar con ID ${familyId}`);
  }

  let targetUser = null;
  if (memberData.email) {
    targetUser = await familyRepo.getUserByEmail(memberData.email);
  } else if (memberData.user_id) {
    targetUser = await familyRepo.getUserById(memberData.user_id);
  }

  if (!targetUser) {
    const detail = memberData.email ? `con correo ${memberData.email}` : `con ID ${memberData.user_id}`;
    throw new NotFoundError(`No se encontró ningún usuario registrado ${detail}`);
  }

  if (targetUser.family_core) {
    if (Number(targetUser.family_core) === Number(familyId)) {
      throw new ConflictError('El usuario ya es integrante de este núcleo familiar');
    } else {
      throw new ConflictError('El usuario ya pertenece a otro núcleo familiar activo');
    }
  }

  invalidateCache();
  await familyRepo.addMemberToFamily(familyId, targetUser.id);
  const updatedMembers = await familyRepo.getFamilyMembers(familyId);

  return {
    id: parseInt(family.id, 10),
    family_name: family.family_name,
    admin_user_id: parseInt(family.admin_user_id, 10),
    created_at: family.created_at,
    updated_at: family.updated_at || null,
    members: updatedMembers.map(formatMember)
  };
}

/**
 * Remove a member from family core
 * @param {number} familyId 
 * @param {number} userId 
 */
async function removeMember(familyId, userId) {
  const family = await familyRepo.getFamilyById(familyId);
  if (!family) {
    throw new NotFoundError(`No se encontró ningún núcleo familiar con ID ${familyId}`);
  }

  if (Number(userId) === Number(family.admin_user_id)) {
    throw new ValidationError('No se puede desvincular al administrador principal del núcleo', [
      { name: 'userId', reason: 'El administrador no puede ser desvinculado; debe transferir el rol o disolver el núcleo' }
    ]);
  }

  const user = await familyRepo.getUserById(userId);
  if (!user || Number(user.family_core) !== Number(familyId)) {
    throw new NotFoundError(`El usuario con ID ${userId} no es integrante de este núcleo familiar`);
  }

  invalidateCache();
  await familyRepo.removeMemberFromFamily(familyId, userId);
  return true;
}

/**
 * Get consolidated financial summary for family core
 * @param {number} familyId 
 * @param {number} [year] 
 */
async function getFamilySummary(familyId, year = new Date().getFullYear()) {
  const cacheKey = `summary:${familyId}:${year}`;
  const cached = familyCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const family = await familyRepo.getFamilyById(familyId);
  if (!family) {
    throw new NotFoundError(`No se encontró ningún núcleo familiar con ID ${familyId}`);
  }

  const { members, directFamilyDebt } = await familyRepo.getFamilyFinancialSummary(familyId, year);

  let totalIncome = 0;
  let totalExpenses = 0;
  let totalDebt = directFamilyDebt;

  const contributions = members.map(m => {
    const inc = parseFloat(m.income) || 0;
    const exp = parseFloat(m.expenses) || 0;
    const debt = parseFloat(m.debt_balance) || 0;
    const net = inc - exp;

    totalIncome += inc;
    totalExpenses += exp;
    totalDebt += debt;

    return {
      user_id: parseInt(m.id, 10),
      name: m.name,
      email: m.email,
      is_admin: Boolean(m.is_admin),
      income: Number(inc.toFixed(2)),
      expenses: Number(exp.toFixed(2)),
      debt_balance: Number(debt.toFixed(2)),
      net_contribution: Number(net.toFixed(2))
    };
  });

  const netBalance = totalIncome - totalExpenses;

  const result = {
    family_id: parseInt(family.id, 10),
    family_name: family.family_name,
    member_count: members.length,
    total_family_income: Number(totalIncome.toFixed(2)),
    total_family_expenses: Number(totalExpenses.toFixed(2)),
    net_family_balance: Number(netBalance.toFixed(2)),
    total_family_debt: Number(totalDebt.toFixed(2)),
    members_contributions: contributions
  };

  familyCache.set(cacheKey, { timestamp: now, data: result });
  return result;
}

module.exports = {
  createFamily,
  getFamilyById,
  getFamilyByUserId,
  addMember,
  removeMember,
  getFamilySummary,
  invalidateCache,
  ValidationError,
  NotFoundError,
  ConflictError
};
