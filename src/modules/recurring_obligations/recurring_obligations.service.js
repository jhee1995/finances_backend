const repo = require('./recurring_obligations.repository');

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

class ForbiddenError extends Error {
  constructor(message = 'Acceso denegado') {
    super(message);
    this.name = 'ForbiddenError';
    this.status = 403;
  }
}

class ConflictError extends Error {
  constructor(message = 'Conflicto de estado') {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
  }
}

function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

// In-memory micro-cache for high-throughput resilience (2.5s TTL)
const obligationsCache = new Map();
const CACHE_TTL_MS = 2500;

function invalidateCache() {
  obligationsCache.clear();
}

/**
 * Create a new recurring obligation
 */
async function createObligation(data, authUserId) {
  const targetUserId = data.user_id || authUserId;

  const category = await repo.getCategory(data.category_id);
  if (!category) {
    throw new ValidationError('La categoría presupuestal seleccionada no existe', [
      { name: 'category_id', reason: 'Categoría no encontrada en el sistema' }
    ]);
  }

  let secondaryDay = data.due_day_secondary;
  if (data.frequency === 'QUINCENAL') {
    if (!secondaryDay) {
      // Default to 15 days later, capped at 30
      secondaryDay = Math.min(30, data.due_day + 15);
    }
  }

  const created = await repo.createObligation({
    ...data,
    user_id: targetUserId,
    due_day_secondary: secondaryDay
  });

  invalidateCache();

  return {
    ...created,
    category_name: category.name
  };
}

/**
 * List obligations for user / family
 */
async function listObligations({ userId, includeFamily = false, status = 'ACTIVE' }) {
  const cacheKey = `list_${userId}_${includeFamily}_${status}`;
  const nowTs = Date.now();
  const cached = obligationsCache.get(cacheKey);
  if (cached && (nowTs - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const familyCoreId = await repo.getUserFamilyCore(userId);
  const result = await repo.listObligations({
    userId,
    familyCoreId,
    includeFamily,
    status
  });

  obligationsCache.set(cacheKey, { timestamp: nowTs, data: result });
  return result;
}

/**
 * Get period status, checklist, and totals
 */
async function getPeriodStatus({ userId, year, month, cycle = null, includeFamily = false }) {
  const now = new Date();
  const currentYear = year || now.getFullYear();
  const currentMonth = month || (now.getMonth() + 1);

  const cacheKey = `status_${userId}_${currentYear}_${currentMonth}_${cycle || 'all'}_${includeFamily}`;
  const nowTs = Date.now();
  const cached = obligationsCache.get(cacheKey);
  if (cached && (nowTs - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const familyCoreId = await repo.getUserFamilyCore(userId);
  const activeObligations = await repo.listObligations({
    userId,
    familyCoreId,
    includeFamily,
    status: 'ACTIVE'
  });

  const obligationIds = activeObligations.map(o => o.id);
  const periodPayments = await repo.findPeriodPayments(obligationIds, currentYear, currentMonth, cycle);

  // Map payments by `${obligation_id}_${period_cycle}`
  const paymentMap = new Map();
  for (const p of periodPayments) {
    paymentMap.set(`${p.obligation_id}_${p.period_cycle}`, p);
  }

  const items = [];
  let totalCommitted = 0;
  let totalCovered = 0;
  let totalPending = 0;
  let totalCount = 0;
  let coveredCount = 0;
  let pendingCount = 0;

  for (const ob of activeObligations) {
    if (ob.frequency === 'MENSUAL') {
      // Monthly obligation: 1 occurrence in the month (cycle = 1)
      // If cycle filter is requested, check if due_day falls in that quincena
      const obCycle = ob.due_day <= 15 ? 1 : 2;
      if (cycle !== null && cycle !== undefined && obCycle !== cycle) {
        continue;
      }

      const pKey = `${ob.id}_1`;
      const payment = paymentMap.get(pKey) || null;
      const isCovered = Boolean(payment);
      const amount = round2(ob.amount);

      totalCommitted += amount;
      totalCount++;

      if (isCovered) {
        totalCovered += round2(payment.actual_amount);
        coveredCount++;
      } else {
        totalPending += amount;
        pendingCount++;
      }

      items.push({
        id: ob.id,
        obligation_id: ob.id,
        name: ob.name,
        amount,
        frequency: ob.frequency,
        cycle: 1,
        due_day: ob.due_day,
        category_id: ob.category_id,
        category_name: ob.category_name,
        is_family: ob.is_family,
        isCovered,
        payment: payment ? {
          payment_id: payment.payment_id,
          payment_date: payment.payment_date,
          actual_amount: payment.actual_amount,
          expense_id: payment.expense_id
        } : null
      });
    } else if (ob.frequency === 'QUINCENAL') {
      // Quincenal: 2 occurrences per month (cycle 1 and cycle 2)
      const cyclesToGenerate = cycle !== null && cycle !== undefined ? [cycle] : [1, 2];

      for (const c of cyclesToGenerate) {
        const pKey = `${ob.id}_${c}`;
        const payment = paymentMap.get(pKey) || null;
        const isCovered = Boolean(payment);
        const amount = round2(ob.amount);
        const dueDay = c === 1 ? ob.due_day : (ob.due_day_secondary || 30);

        totalCommitted += amount;
        totalCount++;

        if (isCovered) {
          totalCovered += round2(payment.actual_amount);
          coveredCount++;
        } else {
          totalPending += amount;
          pendingCount++;
        }

        items.push({
          id: ob.id,
          obligation_id: ob.id,
          name: `${ob.name} (Quincena ${c})`,
          amount,
          frequency: ob.frequency,
          cycle: c,
          due_day: dueDay,
          category_id: ob.category_id,
          category_name: ob.category_name,
          is_family: ob.is_family,
          isCovered,
          payment: payment ? {
            payment_id: payment.payment_id,
            payment_date: payment.payment_date,
            actual_amount: payment.actual_amount,
            expense_id: payment.expense_id
          } : null
        });
      }
    }
  }

  // Sort items by due_day
  items.sort((a, b) => a.due_day - b.due_day);

  const result = {
    period: {
      year: currentYear,
      month: currentMonth,
      cycle: cycle || null,
      label: cycle ? `Quincena ${cycle} de ${currentMonth}/${currentYear}` : `Mes ${currentMonth}/${currentYear}`
    },
    summary: {
      totalCommitted: round2(totalCommitted),
      totalCovered: round2(totalCovered),
      totalPending: round2(totalPending),
      totalCount,
      coveredCount,
      pendingCount
    },
    items
  };

  obligationsCache.set(cacheKey, { timestamp: nowTs, data: result });
  return result;
}

/**
 * Pay recurring obligation and generate outcome expense atomically
 */
async function payObligation(id, payload, authUserId) {
  const obligation = await repo.findById(id);
  if (!obligation) {
    throw new NotFoundError('Obligación periódica no encontrada');
  }

  // Ownership / family authorization check
  if (Number(obligation.user_id) !== Number(authUserId)) {
    const userFamily = await repo.getUserFamilyCore(authUserId);
    const obFamily = await repo.getUserFamilyCore(obligation.user_id);
    if (!obligation.is_family || !userFamily || userFamily !== obFamily) {
      throw new ForbiddenError('No tiene permisos para registrar pagos en esta obligación');
    }
  }

  if (obligation.status === 'INACTIVE') {
    throw new ValidationError('No es posible pagar una obligación que se encuentra inactiva');
  }

  const periodYear = payload.period_year;
  const periodMonth = payload.period_month;
  const periodCycle = payload.period_cycle || 1;
  const actualAmount = payload.actual_amount ? round2(payload.actual_amount) : round2(obligation.amount);
  const paymentDate = payload.payment_date || new Date().toISOString().split('T')[0];

  try {
    const result = await repo.payObligationAtomic({
      obligation,
      userId: authUserId,
      paymentDate,
      actualAmount,
      periodYear,
      periodMonth,
      periodCycle,
      notes: payload.notes
    });

    invalidateCache();

    return {
      payment: result.payment,
      expense: result.expense,
      obligation: {
        id: obligation.id,
        name: obligation.name,
        frequency: obligation.frequency,
        isCovered: true
      }
    };
  } catch (err) {
    if (err.code === 'CONFLICT' || err.code === '23505') {
      throw new ConflictError('La obligación ya se encuentra registrada como pagada para este ciclo');
    }
    throw err;
  }
}

/**
 * Deactivate obligation
 */
async function removeObligation(id, authUserId) {
  const obligation = await repo.findById(id);
  if (!obligation) {
    throw new NotFoundError('Obligación periódica no encontrada');
  }

  if (Number(obligation.user_id) !== Number(authUserId)) {
    const userFamily = await repo.getUserFamilyCore(authUserId);
    const obFamily = await repo.getUserFamilyCore(obligation.user_id);
    if (!obligation.is_family || !userFamily || userFamily !== obFamily) {
      throw new ForbiddenError('No tiene permisos para modificar esta obligación');
    }
  }

  await repo.removeObligation(id);
  invalidateCache();
}

module.exports = {
  createObligation,
  listObligations,
  getPeriodStatus,
  payObligation,
  removeObligation,
  invalidateCache,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError
};
