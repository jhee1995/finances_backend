const db = require('../../shared/database/db');
const debtsRepo = require('./debts.repository');

// In-memory micro-cache for high-throughput resilience (2.5s TTL)
const debtsCache = new Map();
const CACHE_TTL_MS = 2500;

function invalidateCache() {
  debtsCache.clear();
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

class ForbiddenError extends Error {
  constructor(message = 'Acceso denegado') {
    super(message);
    this.name = 'ForbiddenError';
    this.status = 403;
  }
}

/**
 * Register a new debt
 * @param {Object} debtData 
 */
async function registerDebt(debtData) {
  invalidateCache();
  const userExists = await debtsRepo.checkUserExists(debtData.user_id);
  if (!userExists) {
    throw new ValidationError('El usuario especificado no existe', [
      { name: 'user_id', reason: `El usuario con ID ${debtData.user_id} no existe en finances.users` }
    ]);
  }

  // Auto-link family_id if user belongs to family_core
  if (debtData.user_id && !debtData.family_id) {
    const userRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [debtData.user_id]);
    if (userRes.rows[0]?.family_core) {
      debtData.family_id = Number(userRes.rows[0].family_core);
    }
  }

  // Validate category existence and ownership
  const category = await debtsRepo.getCategoryById(debtData.category_id);
  if (!category) {
    throw new ValidationError('La categoría especificada no existe', [
      { name: 'category_id', reason: `La categoría con ID ${debtData.category_id} no existe en finances.categories` }
    ]);
  }

  const matchesUser = Number(category.user_id) === Number(debtData.user_id);
  let matchesFamily = Boolean(debtData.family_id && category.family_id && Number(category.family_id) === Number(debtData.family_id));

  if (!matchesUser && !matchesFamily && debtData.family_id && category.user_id) {
    const catOwnerRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [category.user_id]);
    if (catOwnerRes.rows[0]?.family_core && Number(catOwnerRes.rows[0].family_core) === Number(debtData.family_id)) {
      matchesFamily = true;
    }
  }

  if (!matchesUser && !matchesFamily) {
    throw new ValidationError('La categoría especificada no pertenece al usuario', [
      { name: 'category_id', reason: 'La categoría seleccionada no pertenece al usuario titular ni a su núcleo familiar' }
    ]);
  }

  const numberOfInstallments = Number(debtData.numberOfInstallments);
  let installmentsLeft = debtData.installmentsLeft !== undefined
    ? Number(debtData.installmentsLeft)
    : numberOfInstallments;

  if (installmentsLeft > numberOfInstallments) {
    throw new ValidationError('Inconsistencia en número de cuotas', [
      { name: 'installmentsLeft', reason: 'Las cuotas restantes no pueden superar el plazo total pactado' }
    ]);
  }

  // Automatic status transition if installmentsLeft reaches 0
  let status = debtData.status !== undefined ? debtData.status : true;
  if (installmentsLeft === 0) {
    status = false;
  }

  const record = await debtsRepo.createDebt({
    ...debtData,
    numberOfInstallments,
    installmentsLeft,
    status
  });

  return record;
}

/**
 * List debts with optional filters
 * @param {Object} filters 
 */
async function getDebts(filters = {}) {
  const cacheKey = JSON.stringify(filters);
  const cached = debtsCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const debts = await debtsRepo.listDebts(filters);
  debtsCache.set(cacheKey, { timestamp: now, data: debts });
  return debts;
}

/**
 * Get debt by ID
 * @param {number} id 
 */
async function getDebt(id) {
  const debt = await debtsRepo.getDebtById(id);
  if (!debt) {
    throw new NotFoundError(`La obligación financiera con ID ${id} no fue encontrada`);
  }
  return debt;
}

/**
 * Update debt by ID
 * @param {number} id 
 * @param {Object} updateData 
 */
async function modifyDebt(id, updateData) {
  const existing = await debtsRepo.getDebtById(id);
  if (!existing) {
    throw new NotFoundError(`La obligación financiera con ID ${id} no fue encontrada para actualizar`);
  }

  // Cross-tenant / co-ownership permission check if user_id is provided
  if (updateData.user_id) {
    const actingUserId = Number(updateData.user_id);
    const ownerUserId = existing.user_id ? Number(existing.user_id) : null;
    const debtFamilyId = existing.family_id ? Number(existing.family_id) : null;

    let authorized = false;
    if (ownerUserId && ownerUserId === actingUserId) {
      authorized = true;
    } else {
      const userRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [actingUserId]);
      const actingFamilyCore = userRes.rows[0]?.family_core ? Number(userRes.rows[0].family_core) : null;

      if (actingFamilyCore) {
        if (debtFamilyId && debtFamilyId === actingFamilyCore) {
          authorized = true;
        } else if (ownerUserId) {
          const ownerRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [ownerUserId]);
          const ownerFamilyCore = ownerRes.rows[0]?.family_core ? Number(ownerRes.rows[0].family_core) : null;
          if (ownerFamilyCore && ownerFamilyCore === actingFamilyCore) {
            authorized = true;
          }
        }
      }
    }

    if (!authorized) {
      throw new ValidationError('No tiene permisos para modificar esta obligación financiera', [
        { name: 'user_id', reason: 'El usuario no es propietario ni integrante del núcleo familiar titular de la deuda' }
      ]);
    }
  }

  const effectiveTotal = updateData.numberOfInstallments !== undefined
    ? Number(updateData.numberOfInstallments)
    : Number(existing.numberOfInstallments);

  const effectiveLeft = updateData.installmentsLeft !== undefined
    ? Number(updateData.installmentsLeft)
    : Number(existing.installmentsLeft);

  if (effectiveLeft > effectiveTotal) {
    throw new ValidationError('Inconsistencia en número de cuotas', [
      { name: 'installmentsLeft', reason: 'Las cuotas restantes no pueden superar el plazo total pactado' }
    ]);
  }

  if (updateData.category_id !== undefined) {
    const category = await debtsRepo.getCategoryById(updateData.category_id);
    if (!category) {
      throw new ValidationError('La categoría especificada no existe', [
        { name: 'category_id', reason: `La categoría con ID ${updateData.category_id} no existe en finances.categories` }
      ]);
    }

    const targetUserId = updateData.user_id || existing.user_id;
    const targetFamilyId = updateData.family_id || existing.family_id;
    const matchesUser = Number(category.user_id) === Number(targetUserId);
    let matchesFamily = Boolean(targetFamilyId && category.family_id && Number(category.family_id) === Number(targetFamilyId));

    if (!matchesUser && !matchesFamily && targetFamilyId && category.user_id) {
      const catOwnerRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [category.user_id]);
      if (catOwnerRes.rows[0]?.family_core && Number(catOwnerRes.rows[0].family_core) === Number(targetFamilyId)) {
        matchesFamily = true;
      }
    }

    if (!matchesUser && !matchesFamily) {
      throw new ValidationError('La categoría especificada no pertenece al usuario', [
        { name: 'category_id', reason: 'La categoría seleccionada no pertenece al usuario titular ni a su núcleo familiar' }
      ]);
    }
  }

  // Auto-settlement if cuotas reach 0
  const patch = { ...updateData };
  if (updateData.installmentsLeft === 0 && updateData.status === undefined) {
    patch.status = false;
  }

  invalidateCache();
  return debtsRepo.updateDebt(id, patch);
}

/**
 * Delete debt by ID
 * @param {number} id 
 * @param {number|null} userId 
 */
async function removeDebt(id, userId = null) {
  const existing = await debtsRepo.getDebtById(id);
  if (!existing) {
    throw new NotFoundError(`La obligación financiera con ID ${id} no fue encontrada para eliminar`);
  }

  if (userId) {
    const actingUserId = Number(userId);
    const ownerUserId = existing.user_id ? Number(existing.user_id) : null;
    const debtFamilyId = existing.family_id ? Number(existing.family_id) : null;

    let authorized = false;
    if (ownerUserId && ownerUserId === actingUserId) {
      authorized = true;
    } else {
      const userRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [actingUserId]);
      const actingFamilyCore = userRes.rows[0]?.family_core ? Number(userRes.rows[0].family_core) : null;

      if (actingFamilyCore) {
        if (debtFamilyId && debtFamilyId === actingFamilyCore) {
          authorized = true;
        } else if (ownerUserId) {
          const ownerRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [ownerUserId]);
          const ownerFamilyCore = ownerRes.rows[0]?.family_core ? Number(ownerRes.rows[0].family_core) : null;
          if (ownerFamilyCore && ownerFamilyCore === actingFamilyCore) {
            authorized = true;
          }
        }
      }
    }

    if (!authorized) {
      throw new ValidationError('No tiene permisos para eliminar esta obligación financiera', [
        { name: 'user_id', reason: 'El usuario no es propietario ni integrante del núcleo familiar titular de la deuda' }
      ]);
    }
  }

  invalidateCache();
  return debtsRepo.deleteDebt(id);
}

function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

function calculateDueDate(beginDateStr, installmentNumber, preParsed = null) {
  const [year, month, day] = preParsed || beginDateStr.split('-').map(Number);
  const totalMonths = month - 1 + installmentNumber;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonthIndex = totalMonths % 12;
  const m = targetMonthIndex + 1;
  let maxDays = 31;
  if (m === 2) {
    const isLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
    maxDays = isLeap ? 29 : 28;
  } else if (m === 4 || m === 6 || m === 9 || m === 11) {
    maxDays = 30;
  }
  const effectiveDay = day > maxDays ? maxDays : day;
  const mm = m < 10 ? `0${m}` : `${m}`;
  const dd = effectiveDay < 10 ? `0${effectiveDay}` : `${effectiveDay}`;
  return `${targetYear}-${mm}-${dd}`;
}

/**
 * Simulate debt amortization schedule (Contract: DEB-006, US-009)
 * @param {Object} params 
 * @param {number|null} actingUserId 
 */
async function simulateDebt(params, actingUserId = null) {
  let amount;
  let interestRateEA;
  let installments;
  let beginDate;
  let system = (params.system || 'FRENCH').toUpperCase();

  if (params.debtId) {
    const existing = await debtsRepo.getDebtById(params.debtId);
    if (!existing) {
      throw new NotFoundError(`La obligación financiera con ID ${params.debtId} no fue encontrada para simular`);
    }

    if (actingUserId) {
      const actingId = Number(actingUserId);
      const ownerId = existing.user_id ? Number(existing.user_id) : null;
      const debtFamilyId = existing.family_id ? Number(existing.family_id) : null;
      let authorized = Boolean(ownerId && ownerId === actingId);

      if (!authorized) {
        const userRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [actingId]);
        const actingFamilyCore = userRes.rows[0]?.family_core ? Number(userRes.rows[0].family_core) : null;

        if (actingFamilyCore) {
          if (debtFamilyId && debtFamilyId === actingFamilyCore) {
            authorized = true;
          } else if (ownerId) {
            const ownerRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [ownerId]);
            const ownerFamilyCore = ownerRes.rows[0]?.family_core ? Number(ownerRes.rows[0].family_core) : null;
            if (ownerFamilyCore && ownerFamilyCore === actingFamilyCore) {
              authorized = true;
            }
          }
        }
      }

      if (!authorized) {
        throw new ForbiddenError('No tiene permisos para consultar o simular sobre esta obligación financiera');
      }
    }

    amount = params.amount !== undefined ? Number(params.amount) : Number(existing.loan_amount);
    interestRateEA = params.interestRateEA !== undefined ? Number(params.interestRateEA) : Number(existing.interest_rate);
    installments = params.installments !== undefined
      ? Number(params.installments)
      : Number(existing.installmentsLeft || existing.numberOfInstallments);
    beginDate = params.beginDate || (existing.begin_date ? new Date(existing.begin_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  } else {
    amount = Number(params.amount);
    interestRateEA = Number(params.interestRateEA);
    installments = Number(params.installments);
    beginDate = params.beginDate || new Date().toISOString().slice(0, 10);
  }

  // Periodic nominal monthly rate calculation
  let im = 0;
  let nominalMonthlyRate = 0.00;
  if (interestRateEA > 0) {
    im = Math.pow(1 + interestRateEA / 100, 1 / 12) - 1;
    nominalMonthlyRate = Number((im * 100).toFixed(4));
  }

  const extraMap = new Map();
  if (Array.isArray(params.extraPayments)) {
    for (const ep of params.extraPayments) {
      extraMap.set(Number(ep.installmentNumber), {
        amount: Number(ep.amount),
        type: (ep.type || 'REDUCE_TERM').toUpperCase()
      });
    }
  }

  const rows = [];
  const maxLoops = Math.min(installments, 360);
  const preParsedDate = beginDate.split('-').map(Number);

  if (system === 'GERMAN') {
    const fixedPrincipal = round2(amount / installments);
    let currentBalance = round2(amount);
    let k = 1;

    while (currentBalance > 0.005 && k <= maxLoops) {
      const initialBalance = round2(currentBalance);
      const dueDate = calculateDueDate(beginDate, k, preParsedDate);
      const interestAmount = round2(initialBalance * im);

      const ep = extraMap.get(k);
      let extraPaymentAmount = 0;
      if (ep && ep.amount > 0) {
        extraPaymentAmount = ep.amount;
      }

      let principalAmount;
      let installmentAmount;
      let endingBalance;

      const isLastScheduled = (k === installments);
      if (isLastScheduled || fixedPrincipal >= initialBalance) {
        principalAmount = initialBalance;
        installmentAmount = round2(principalAmount + interestAmount);
        extraPaymentAmount = 0;
        endingBalance = 0;
        currentBalance = 0;
      } else {
        principalAmount = fixedPrincipal;
        installmentAmount = round2(principalAmount + interestAmount);
        const maxExtra = Math.max(0, round2(initialBalance - principalAmount));
        const appliedExtra = Math.min(extraPaymentAmount, maxExtra);
        extraPaymentAmount = appliedExtra;
        endingBalance = Math.max(0, round2(initialBalance - principalAmount - appliedExtra));
        currentBalance = endingBalance;
      }

      rows.push({
        installmentNumber: k,
        dueDate,
        initialBalance,
        installmentAmount,
        interestAmount,
        principalAmount,
        extraPaymentAmount: round2(extraPaymentAmount),
        endingBalance
      });

      k++;
    }
  } else {
    // FRENCH (Standard default)
    let fixedPayment;
    if (im === 0) {
      fixedPayment = amount / installments;
    } else {
      fixedPayment = amount * (im / (1 - Math.pow(1 + im, -installments)));
    }

    let currentInstallmentAmount = round2(fixedPayment);
    let currentBalance = round2(amount);
    let k = 1;

    while (currentBalance > 0.005 && k <= maxLoops) {
      const initialBalance = round2(currentBalance);
      const dueDate = calculateDueDate(beginDate, k, preParsedDate);
      const interestAmount = round2(initialBalance * im);

      const ep = extraMap.get(k);
      let extraPaymentAmount = 0;
      let extraType = 'REDUCE_TERM';
      if (ep && ep.amount > 0) {
        extraType = ep.type;
        extraPaymentAmount = ep.amount;
      }

      let principalAmount;
      let installmentAmount;
      let endingBalance;

      const isLastScheduled = (k === installments);
      const standardPrincipal = round2(currentInstallmentAmount - interestAmount);

      if (isLastScheduled || standardPrincipal >= initialBalance) {
        principalAmount = initialBalance;
        installmentAmount = round2(principalAmount + interestAmount);
        extraPaymentAmount = 0;
        endingBalance = 0;
        currentBalance = 0;
      } else {
        principalAmount = standardPrincipal;
        installmentAmount = currentInstallmentAmount;
        const maxExtra = Math.max(0, round2(initialBalance - principalAmount));
        const appliedExtra = Math.min(extraPaymentAmount, maxExtra);
        extraPaymentAmount = appliedExtra;
        endingBalance = Math.max(0, round2(initialBalance - principalAmount - appliedExtra));
        currentBalance = endingBalance;

        if (appliedExtra > 0 && extraType === 'REDUCE_PAYMENT' && currentBalance > 0) {
          const remainingTerms = installments - k;
          if (remainingTerms > 0) {
            if (im === 0) {
              currentInstallmentAmount = round2(currentBalance / remainingTerms);
            } else {
              currentInstallmentAmount = round2(currentBalance * (im / (1 - Math.pow(1 + im, -remainingTerms))));
            }
          }
        }
      }

      rows.push({
        installmentNumber: k,
        dueDate,
        initialBalance,
        installmentAmount,
        interestAmount,
        principalAmount,
        extraPaymentAmount: round2(extraPaymentAmount),
        endingBalance
      });

      k++;
    }
  }

  const totalPrincipal = round2(rows.reduce((sum, r) => sum + r.principalAmount + r.extraPaymentAmount, 0));
  const totalInterest = round2(rows.reduce((sum, r) => sum + r.interestAmount, 0));
  const totalExtraPayments = round2(rows.reduce((sum, r) => sum + r.extraPaymentAmount, 0));
  const totalPaid = round2(totalPrincipal + totalInterest);
  const monthlyPayment = rows[0]?.installmentAmount || 0;
  const effectiveTerm = rows.length;

  return {
    summary: {
      loanAmount: round2(amount),
      interestRateEA: round2(interestRateEA),
      nominalMonthlyRate,
      monthlyPayment,
      totalInterest,
      totalPrincipal,
      totalPaid,
      totalExtraPayments,
      effectiveTerm,
      system
    },
    amortizationTable: rows
  };
}

async function checkDebtAccess(debt, actingUserId) {
  if (!actingUserId) return true;
  const actingId = Number(actingUserId);
  const ownerId = debt.user_id ? Number(debt.user_id) : null;
  const debtFamilyId = debt.family_id ? Number(debt.family_id) : null;

  if (ownerId && ownerId === actingId) {
    return true;
  }

  const userRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [actingId]);
  const actingFamilyCore = userRes.rows[0]?.family_core ? Number(userRes.rows[0].family_core) : null;

  if (actingFamilyCore) {
    if (debtFamilyId && debtFamilyId === actingFamilyCore) {
      return true;
    }
    if (ownerId) {
      const ownerRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [ownerId]);
      const ownerFamilyCore = ownerRes.rows[0]?.family_core ? Number(ownerRes.rows[0].family_core) : null;
      if (ownerFamilyCore && ownerFamilyCore === actingFamilyCore) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Record a payment on a debt with flexible amount, recalculation and ACID transaction
 * @param {number} debtId 
 * @param {{ amount: number, payment_date?: string, user_id?: number }} paymentData 
 * @param {number|null} actingUserId 
 */
async function recordDebtPayment(debtId, paymentData, actingUserId = null) {
  const existing = await debtsRepo.getDebtById(debtId);
  if (!existing) {
    throw new NotFoundError(`La obligación financiera con ID ${debtId} no fue encontrada`);
  }

  const userId = paymentData.user_id || actingUserId || existing.user_id;
  const authorized = await checkDebtAccess(existing, userId);
  if (!authorized) {
    throw new NotFoundError(`La obligación financiera con ID ${debtId} no fue encontrada`);
  }

  const amount = Number(paymentData.amount);
  const paymentDate = paymentData.payment_date || new Date().toISOString().slice(0, 10);

  const P = Number(existing.loan_amount);
  const ea = Number(existing.interest_rate);
  const n = Number(existing.installmentsLeft || existing.numberOfInstallments || 1);
  const im = ea > 0 ? (Math.pow(1 + ea / 100, 1 / 12) - 1) : 0;
  const interestAmount = round2(P * im);
  const previousMonthlyPayment = debtsRepo.calculateMonthlyInstallment(P, ea, n);

  let interestApplied;
  let principalPortion;
  let newBalance;
  let isFullyPaid;
  let newInstallmentsLeft;
  let newMonthlyPayment;

  if (amount >= round2(P + interestAmount)) {
    // Total liquidation
    interestApplied = interestAmount;
    principalPortion = P;
    newBalance = 0;
    isFullyPaid = true;
    newInstallmentsLeft = 0;
    newMonthlyPayment = 0;
  } else {
    interestApplied = Math.min(interestAmount, amount);
    principalPortion = Math.max(0, round2(amount - interestApplied));
    newBalance = Math.max(0, round2(P - principalPortion));
    isFullyPaid = (newBalance <= 0.005);

    if (isFullyPaid) {
      newBalance = 0;
      newInstallmentsLeft = 0;
      newMonthlyPayment = 0;
    } else {
      newInstallmentsLeft = Math.max(1, n - 1);
      newMonthlyPayment = debtsRepo.calculateMonthlyInstallment(newBalance, ea, newInstallmentsLeft);
    }
  }

  const result = await debtsRepo.recordDebtPayment({
    debtId,
    userId,
    amount,
    paymentDate,
    newBalance,
    newInstallmentsLeft,
    isFullyPaid
  });

  invalidateCache();
  try {
    const dashboardService = require('../dashboard/dashboard.service');
    if (dashboardService._clearCache) {
      dashboardService._clearCache();
    }
  } catch (e) {
    // ignore
  }

  return {
    payment: result.payment,
    debt: result.debt,
    recalculation: {
      previous_balance: P,
      new_balance: newBalance,
      interest_portion: interestApplied,
      principal_portion: principalPortion,
      previous_monthly_payment: previousMonthlyPayment,
      new_monthly_payment: newMonthlyPayment,
      installments_left: newInstallmentsLeft,
      is_fully_paid: isFullyPaid
    }
  };
}

/**
 * Get payment history for a debt
 * @param {number} debtId 
 * @param {number|null} actingUserId 
 */
async function getDebtPayments(debtId, actingUserId = null) {
  const existing = await debtsRepo.getDebtById(debtId);
  if (!existing) {
    throw new NotFoundError(`La obligación financiera con ID ${debtId} no fue encontrada`);
  }

  if (actingUserId) {
    const authorized = await checkDebtAccess(existing, actingUserId);
    if (!authorized) {
      throw new NotFoundError(`La obligación financiera con ID ${debtId} no fue encontrada`);
    }
  }

  return debtsRepo.getDebtPayments(debtId);
}

module.exports = {
  registerDebt,
  getDebts,
  getDebt,
  modifyDebt,
  removeDebt,
  simulateDebt,
  recordDebtPayment,
  getDebtPayments,
  ValidationError,
  NotFoundError,
  ForbiddenError
};
