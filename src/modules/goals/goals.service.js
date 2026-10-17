const goalsRepo = require('./goals.repository');

// Micro-cache to satisfy sub-150ms p95 latency under high concurrency
const goalsCache = new Map();
const CACHE_TTL_MS = 2500;

function getCacheKey(userId, includeFamily) {
  return `goals:${userId || 'all'}:${Boolean(includeFamily)}`;
}

function invalidateCache() {
  goalsCache.clear();
}

/**
 * Service to register a new financial goal
 */
async function createGoal(payload, actingUserId = 1) {
  const userId = payload.userId || actingUserId;

  if (payload.isDebt) {
    if (!payload.debtId) {
      const error = new Error('debtId es requerido cuando isDebt es verdadero');
      error.status = 422;
      error.invalid_params = [{ name: 'debtId', reason: 'debtId es requerido cuando isDebt es verdadero' }];
      throw error;
    }

    const access = await goalsRepo.checkDebtAccess(payload.debtId, userId);
    if (!access.exists || !access.hasAccess) {
      const error = new Error('La obligación financiera vinculada no existe o no pertenece a su usuario/núcleo familiar');
      error.status = 422;
      error.invalid_params = [{ name: 'debtId', reason: 'La obligación financiera no existe o no está autorizada' }];
      throw error;
    }
  }

  const created = await goalsRepo.createGoal({
    userId,
    goalName: payload.goalName,
    amount: payload.amount,
    currentAmount: payload.currentAmount !== undefined ? payload.currentAmount : 0,
    targetDate: payload.targetDate || null,
    isDebt: Boolean(payload.isDebt),
    debtId: payload.isDebt ? payload.debtId : null
  });

  invalidateCache();
  return created;
}

/**
 * Retrieve list of goals with summary aggregations
 */
async function getGoals({ userId = 1, includeFamily = false } = {}) {
  const cacheKey = getCacheKey(userId, includeFamily);
  const cached = goalsCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const goals = await goalsRepo.getGoalsByUser(userId, { includeFamily });

  const totalTargetAmount = goals.reduce((acc, g) => acc + (Number(g.amount) || 0), 0);
  const totalCurrentAmount = goals.reduce((acc, g) => acc + (Number(g.currentAmount) || 0), 0);
  const globalProgressPercent = totalTargetAmount > 0
    ? Math.min(100, Math.round(((totalCurrentAmount / totalTargetAmount) * 100) * 100) / 100)
    : 0;

  const result = {
    totalTargetAmount,
    totalCurrentAmount,
    globalProgressPercent,
    goalsCount: goals.length,
    goals
  };

  goalsCache.set(cacheKey, { timestamp: Date.now(), data: result });
  return result;
}

/**
 * Get goal by ID
 */
async function getGoalById(id, actingUserId = 1) {
  const goal = await goalsRepo.getGoalById(id);
  if (!goal) {
    const error = new Error(`Meta con ID ${id} no encontrada`);
    error.status = 404;
    throw error;
  }

  return goal;
}

/**
 * Update goal by ID
 */
async function updateGoal(id, payload, actingUserId = 1) {
  const existing = await goalsRepo.getGoalById(id);
  if (!existing) {
    const error = new Error(`Meta con ID ${id} no encontrada`);
    error.status = 404;
    throw error;
  }

  // Validate debt if being linked
  if (payload.isDebt === true || (payload.debtId && existing.isDebt)) {
    const debtId = payload.debtId || existing.debtId;
    if (!debtId) {
      const error = new Error('debtId es requerido cuando isDebt es verdadero');
      error.status = 422;
      error.invalid_params = [{ name: 'debtId', reason: 'debtId es requerido' }];
      throw error;
    }

    const access = await goalsRepo.checkDebtAccess(debtId, existing.userId);
    if (!access.exists || !access.hasAccess) {
      const error = new Error('La obligación financiera vinculada no existe o no pertenece a su usuario');
      error.status = 422;
      error.invalid_params = [{ name: 'debtId', reason: 'La obligación financiera no existe o no está autorizada' }];
      throw error;
    }
  }

  if (payload.isDebt === false) {
    payload.debtId = null;
  }

  const updated = await goalsRepo.updateGoal(id, payload);
  invalidateCache();
  return updated;
}

/**
 * Delete goal by ID
 */
async function deleteGoal(id, actingUserId = 1) {
  const existing = await goalsRepo.getGoalById(id);
  if (!existing) {
    const error = new Error(`Meta con ID ${id} no encontrada`);
    error.status = 404;
    throw error;
  }

  await goalsRepo.deleteGoal(id);
  invalidateCache();
  return true;
}

module.exports = {
  createGoal,
  getGoals,
  getGoalById,
  updateGoal,
  deleteGoal,
  invalidateCache
};
