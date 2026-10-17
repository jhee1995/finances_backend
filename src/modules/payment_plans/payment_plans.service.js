const paymentPlansRepo = require('./payment_plans.repository');

// In-memory micro-cache for high-throughput resilience (2.5s TTL)
const plansCache = new Map();
const CACHE_TTL_MS = 2500;

function invalidateCache() {
  plansCache.clear();
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

function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate fixed monthly installment (French system)
 * @param {number} amount 
 * @param {number} rateEA 
 * @param {number} installments 
 */
function calculateMonthlyPayment(amount, rateEA, installments) {
  const p = Number(amount);
  const n = Math.max(1, Number(installments));
  const ea = Number(rateEA);

  if (p <= 0) return 0;
  if (ea <= 0) {
    return round2(p / n);
  }

  const im = Math.pow(1 + ea / 100, 1 / 12) - 1;
  const payment = p * (im / (1 - Math.pow(1 + im, -n)));
  return round2(payment);
}

/**
 * Simulate amortization cascade for a prioritized debt sequence
 * @param {Array} originalDebts 
 * @param {Array<number>} orderIds 
 * @param {number} extraMonthlyBudget 
 * @param {number} baselineTotalInterest 
 */
function simulateCascade(originalDebts, orderIds, extraMonthlyBudget, baselineTotalInterest) {
  if (!originalDebts || originalDebts.length === 0) {
    return {
      totalMonths: 0,
      totalInterest: 0,
      totalPaid: 0,
      totalSavings: 0,
      monthlyCommitment: 0
    };
  }

  // Clone debts with tracking balances and rates
  const debts = originalDebts.map(d => {
    const p = round2(d.loan_amount);
    const ea = Number(d.interest_rate);
    const n = Math.max(1, Number(d.installmentsLeft || d.numberOfInstallments || 1));
    const im = ea > 0 ? (Math.pow(1 + ea / 100, 1 / 12) - 1) : 0;
    const minPayment = calculateMonthlyPayment(p, ea, n);

    return {
      id: d.id,
      balance: p,
      initialAmount: p,
      im,
      minPayment,
      isPaid: false
    };
  });

  const baseMonthlyTotal = round2(debts.reduce((sum, d) => sum + d.minPayment, 0));
  const monthlyCommitment = round2(baseMonthlyTotal + extraMonthlyBudget);

  let totalInterestPaid = 0;
  let totalPrincipalPaid = 0;
  let month = 0;
  const maxMonths = 600; // 50 years safety limit

  while (debts.some(d => d.balance > 0.005) && month < maxMonths) {
    month++;
    let extraAvailable = extraMonthlyBudget;

    // Phase 1: Accrue monthly interest and apply standard minimum payments
    for (const d of debts) {
      if (d.balance > 0.005) {
        const interest = round2(d.balance * d.im);
        totalInterestPaid = round2(totalInterestPaid + interest);
        d.balance = round2(d.balance + interest);

        const payment = Math.min(d.minPayment, d.balance);
        const principal = round2(payment - interest);
        d.balance = Math.max(0, round2(d.balance - payment));
        totalPrincipalPaid = round2(totalPrincipalPaid + principal);

        if (d.balance <= 0.005) {
          d.isPaid = true;
        }
      } else {
        // Debt was already paid in previous months: roll over its minPayment
        extraAvailable = round2(extraAvailable + d.minPayment);
      }
    }

    // Phase 2: In priority order, apply extra budget and freed-up snowball minimums
    for (const targetId of orderIds) {
      if (extraAvailable <= 0.005) break;
      const target = debts.find(d => d.id === targetId);
      if (target && target.balance > 0.005) {
        const extraToPay = Math.min(extraAvailable, target.balance);
        target.balance = Math.max(0, round2(target.balance - extraToPay));
        totalPrincipalPaid = round2(totalPrincipalPaid + extraToPay);
        extraAvailable = round2(extraAvailable - extraToPay);

        if (target.balance <= 0.005) {
          target.isPaid = true;
        }
      }
    }
  }

  const totalPaid = round2(totalPrincipalPaid + totalInterestPaid);
  const totalSavings = Math.max(0, round2(baselineTotalInterest - totalInterestPaid));

  return {
    totalMonths: month,
    totalInterest: totalInterestPaid,
    totalPaid,
    totalSavings,
    monthlyCommitment
  };
}

/**
 * Builds an enriched StrategyResult object with humanized sequence and freedom commitment metrics (US-021)
 */
function buildStrategyResult({
  strategyKey,
  title,
  tag,
  sortedDebts,
  simulationRes,
  extraMonthlyBudget,
  totalBaseInstallments,
  explanation,
  consolidatedRateEA
}) {
  const sequence = sortedDebts.map((d, idx) => ({
    priority: idx + 1,
    debtId: d.id,
    name: d.name || d.category_name || 'Obligación Financiera',
    category_name: d.category_name || null,
    loan_amount: round2(d.loan_amount),
    interest_rate: round2(d.interest_rate),
    monthlyPayment: round2(d.monthlyPayment)
  }));

  const order = sortedDebts.map(d => d.id);
  const priorityDebt = sequence.length > 0
    ? {
        id: sequence[0].debtId,
        name: sequence[0].name,
        loan_amount: sequence[0].loan_amount,
        monthlyPayment: sequence[0].monthlyPayment
      }
    : null;

  const monthlyFreedomCommitment = round2(totalBaseInstallments + extraMonthlyBudget);

  let monthlyInstruction = '';
  if (sequence.length === 0) {
    monthlyInstruction = 'No tienes obligaciones financieras activas pendientes por pagar.';
  } else if (extraMonthlyBudget > 0) {
    monthlyInstruction = `Para cumplir con tu objetivo de libertad financiera mediante el ${title}, este mes debes destinar $${monthlyFreedomCommitment.toLocaleString('es-CO')} a tus deudas: $${totalBaseInstallments.toLocaleString('es-CO')} para cubrir las cuotas mínimas y $${extraMonthlyBudget.toLocaleString('es-CO')} como ataque acelerado a tu deuda prioritaria: "${priorityDebt.name}".`;
  } else {
    monthlyInstruction = `Para mantener tus créditos al día mediante el ${title}, este mes debes destinar $${totalBaseInstallments.toLocaleString('es-CO')} para cubrir las cuotas mínimas pactadas. Si logras aportar un presupuesto extra adicional, acelerarás la liquidación de tu deuda prioritaria: "${priorityDebt.name}".`;
  }

  const resObj = {
    strategy: strategyKey,
    title,
    tag,
    order,
    sequence,
    totalMonths: simulationRes.totalMonths,
    totalInterest: simulationRes.totalInterest,
    totalPaid: simulationRes.totalPaid,
    totalSavings: simulationRes.totalSavings,
    monthlyCommitment: simulationRes.monthlyCommitment,
    monthlyFreedomCommitment,
    totalBaseInstallments,
    extraMonthlyBudget,
    priorityDebt,
    monthlyInstruction,
    explanation
  };

  if (consolidatedRateEA !== undefined) {
    resObj.consolidatedRateEA = consolidatedRateEA;
  }

  return resObj;
}

/**
 * Compare all 5 repayment strategies for the authenticated user
 * @param {number} userId 
 * @param {Object} params 
 */
async function comparePaymentStrategies(userId, params = {}) {
  const extraMonthlyBudget = round2(params.extraMonthlyBudget || 0);
  const consolidationRateEA = Number(params.consolidationRateEA !== undefined ? params.consolidationRateEA : 16.0);
  const snowflakeAmount = round2(params.snowflakeAmount || 0);
  const includeFamily = params.includeFamilyDebts !== undefined ? Boolean(params.includeFamilyDebts) : true;

  const cacheKey = `debts_${userId}_${includeFamily}`;
  const now = Date.now();
  const cached = plansCache.get(cacheKey);
  let rawDebts;
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    rawDebts = cached.data;
  } else {
    rawDebts = await paymentPlansRepo.getActiveDebtsForUser(userId, includeFamily);
    plansCache.set(cacheKey, { timestamp: now, data: rawDebts });
  }

  if (!rawDebts || rawDebts.length === 0) {
    const emptyStrategy = (strategy, title, tag, explanation) => ({
      strategy,
      title,
      tag,
      order: [],
      sequence: [],
      totalMonths: 0,
      totalInterest: 0,
      totalPaid: 0,
      totalSavings: 0,
      monthlyCommitment: extraMonthlyBudget,
      monthlyFreedomCommitment: extraMonthlyBudget,
      totalBaseInstallments: 0,
      extraMonthlyBudget,
      priorityDebt: null,
      monthlyInstruction: 'No tienes obligaciones activas registradas para optimizar.',
      explanation
    });

    return {
      summary: {
        totalDebts: 0,
        totalCurrentDebt: 0,
        totalBaseInstallments: 0,
        baselineTotalInterest: 0,
        baselineTotalMonths: 0,
        optimalStrategy: 'NONE',
        extraMonthlyBudget
      },
      strategies: {
        AVALANCHE: emptyStrategy('AVALANCHE', 'Método Avalancha', 'Máximo Ahorro Financiero', 'No hay obligaciones activas registradas para optimizar.'),
        SNOWBALL: emptyStrategy('SNOWBALL', 'Método Bola de Nieve', 'Victoria Psicológica Temprana', 'No hay obligaciones activas registradas para optimizar.'),
        TSUNAMI: emptyStrategy('TSUNAMI', 'Método Tsunami', 'Alivio de Flujo de Caja', 'No hay obligaciones activas registradas para optimizar.'),
        CONSOLIDATION: emptyStrategy('CONSOLIDATION', 'Consolidación de Deuda', 'Unificación de Cuota', 'No hay obligaciones activas registradas para consolidar.'),
        SNOWFLAKE: emptyStrategy('SNOWFLAKE', 'Copos de Nieve (Micro-Ahorros)', 'Aceleración Diaria / Periódica', 'No hay obligaciones activas registradas para acelerar.')
      },
      debts: []
    };
  }

  // Pre-calculate debt installments and baseline
  const debts = rawDebts.map(d => {
    const monthlyPayment = calculateMonthlyPayment(
      d.loan_amount,
      d.interest_rate,
      d.installmentsLeft || d.numberOfInstallments || 1
    );
    return {
      ...d,
      monthlyPayment
    };
  });

  const totalCurrentDebt = round2(debts.reduce((sum, d) => sum + d.loan_amount, 0));
  const totalBaseInstallments = round2(debts.reduce((sum, d) => sum + d.monthlyPayment, 0));

  // Compute baseline (paying minimums without acceleration)
  let baselineTotalInterest = 0;
  let baselineTotalMonths = 0;

  for (const d of debts) {
    const n = Math.max(1, Number(d.installmentsLeft || d.numberOfInstallments || 1));
    const ea = Number(d.interest_rate);
    const im = ea > 0 ? (Math.pow(1 + ea / 100, 1 / 12) - 1) : 0;
    let b = round2(d.loan_amount);
    let debtInterest = 0;

    for (let k = 1; k <= n && b > 0.005; k++) {
      const interest = round2(b * im);
      debtInterest = round2(debtInterest + interest);
      b = round2(b + interest);
      const payment = Math.min(d.monthlyPayment, b);
      b = Math.max(0, round2(b - payment));
    }

    baselineTotalInterest = round2(baselineTotalInterest + debtInterest);
    if (n > baselineTotalMonths) {
      baselineTotalMonths = n;
    }
  }

  // Strategy 1: AVALANCHE (Highest interest rate first)
  const avalancheSorted = [...debts].sort((a, b) => {
    if (b.interest_rate !== a.interest_rate) {
      return b.interest_rate - a.interest_rate;
    }
    return a.loan_amount - b.loan_amount;
  });
  const avalancheOrder = avalancheSorted.map(d => d.id);
  const avalancheRes = simulateCascade(debts, avalancheOrder, extraMonthlyBudget, baselineTotalInterest);

  // Strategy 2: SNOWBALL (Lowest balance first)
  const snowballSorted = [...debts].sort((a, b) => {
    if (a.loan_amount !== b.loan_amount) {
      return a.loan_amount - b.loan_amount;
    }
    return b.interest_rate - a.interest_rate;
  });
  const snowballOrder = snowballSorted.map(d => d.id);
  const snowballRes = simulateCascade(debts, snowballOrder, extraMonthlyBudget, baselineTotalInterest);

  // Strategy 3: TSUNAMI (Highest payment to balance ratio first -> fast cash flow relief)
  const tsunamiSorted = [...debts].sort((a, b) => {
    const ratioA = a.loan_amount > 0 ? (a.monthlyPayment / a.loan_amount) : 0;
    const ratioB = b.loan_amount > 0 ? (b.monthlyPayment / b.loan_amount) : 0;
    if (ratioB !== ratioA) {
      return ratioB - ratioA;
    }
    return b.interest_rate - a.interest_rate;
  });
  const tsunamiOrder = tsunamiSorted.map(d => d.id);
  const tsunamiRes = simulateCascade(debts, tsunamiOrder, extraMonthlyBudget, baselineTotalInterest);

  // Strategy 4: CONSOLIDATION (Unified single loan simulation)
  const consN = Math.max(12, Math.min(baselineTotalMonths, 60));
  const consIm = consolidationRateEA > 0 ? (Math.pow(1 + consolidationRateEA / 100, 1 / 12) - 1) : 0;
  const consPayment = calculateMonthlyPayment(totalCurrentDebt, consolidationRateEA, consN);
  const consOrder = debts.map(d => d.id);

  // Simulate consolidated single debt with extra budget
  let consBalance = totalCurrentDebt;
  let consTotalInterest = 0;
  let consMonths = 0;
  const consMonthlyCommitment = round2(consPayment + extraMonthlyBudget);

  while (consBalance > 0.005 && consMonths < 600) {
    consMonths++;
    const interest = round2(consBalance * consIm);
    consTotalInterest = round2(consTotalInterest + interest);
    consBalance = round2(consBalance + interest);

    const payment = Math.min(consMonthlyCommitment, consBalance);
    consBalance = Math.max(0, round2(consBalance - payment));
  }

  const consTotalPaid = round2(totalCurrentDebt + consTotalInterest);
  const consTotalSavings = Math.max(0, round2(baselineTotalInterest - consTotalInterest));
  const consRes = {
    totalMonths: consMonths,
    totalInterest: consTotalInterest,
    totalPaid: consTotalPaid,
    totalSavings: consTotalSavings,
    monthlyCommitment: consMonthlyCommitment
  };

  // Strategy 5: SNOWFLAKE (Avalanche + Periodic micro-savings)
  const microSavings = snowflakeAmount > 0
    ? snowflakeAmount
    : Math.max(25000, round2(extraMonthlyBudget * 0.15));
  const snowflakeExtra = round2(extraMonthlyBudget + microSavings);
  const snowflakeRes = simulateCascade(debts, avalancheOrder, snowflakeExtra, baselineTotalInterest);

  // Determine optimal strategy (default Avalanche for mathematical maximum savings)
  let optimalStrategy = 'AVALANCHE';
  if (snowballRes.totalSavings >= avalancheRes.totalSavings && snowballRes.totalMonths <= avalancheRes.totalMonths) {
    optimalStrategy = 'SNOWBALL';
  }

  return {
    summary: {
      totalDebts: debts.length,
      totalCurrentDebt,
      totalBaseInstallments,
      baselineTotalInterest,
      baselineTotalMonths,
      optimalStrategy,
      extraMonthlyBudget
    },
    strategies: {
      AVALANCHE: buildStrategyResult({
        strategyKey: 'AVALANCHE',
        title: 'Método Avalancha',
        tag: 'Máximo Ahorro Financiero',
        sortedDebts: avalancheSorted,
        simulationRes: avalancheRes,
        extraMonthlyBudget,
        totalBaseInstallments,
        explanation: 'Prioriza las deudas con mayor tasa de interés. Es la metodología matemáticamente óptima para pagar la menor cantidad posible en intereses.'
      }),
      SNOWBALL: buildStrategyResult({
        strategyKey: 'SNOWBALL',
        title: 'Método Bola de Nieve',
        tag: 'Victoria Psicológica Temprana',
        sortedDebts: snowballSorted,
        simulationRes: snowballRes,
        extraMonthlyBudget,
        totalBaseInstallments,
        explanation: 'Liquida primero los saldos más pequeños para obtener victorias rápidas y liberar cuotas completas en el menor tiempo.'
      }),
      TSUNAMI: buildStrategyResult({
        strategyKey: 'TSUNAMI',
        title: 'Método Tsunami',
        tag: 'Alivio de Flujo de Caja',
        sortedDebts: tsunamiSorted,
        simulationRes: tsunamiRes,
        extraMonthlyBudget,
        totalBaseInstallments,
        explanation: 'Ataca primero las cuotas más pesadas respecto a su saldo, aliviando rápidamente la presión sobre tus ingresos mensuales disponibles.'
      }),
      CONSOLIDATION: buildStrategyResult({
        strategyKey: 'CONSOLIDATION',
        title: 'Consolidación de Deuda',
        tag: 'Unificación de Cuota',
        sortedDebts: debts,
        simulationRes: consRes,
        extraMonthlyBudget,
        totalBaseInstallments,
        explanation: `Simula agrupar tus obligaciones en un único crédito con tasa preferencial del ${consolidationRateEA}% EA y una sola cuota mensual unificada.`,
        consolidatedRateEA: consolidationRateEA
      }),
      SNOWFLAKE: buildStrategyResult({
        strategyKey: 'SNOWFLAKE',
        title: 'Copos de Nieve (Micro-Ahorros)',
        tag: 'Aceleración Diaria / Periódica',
        sortedDebts: avalancheSorted,
        simulationRes: snowflakeRes,
        extraMonthlyBudget: snowflakeExtra,
        totalBaseInstallments,
        explanation: `Incorpora micro-ahorros adicionales ($${microSavings.toLocaleString('es-CO')} periódicos) al método avalancha para acelerar aún más tu libertad financiera.`
      })
    },
    debts
  };
}

/**
 * Save selected payment plan for a user
 * @param {number} userId 
 * @param {Object} planData 
 */
async function selectPaymentPlan(userId, planData) {
  invalidateCache();
  const { strategy, order, extraMonthlyBudget = 0 } = planData;

  // Calculate remaining amount based on active debts
  let remainingAmount = planData.remainingAmount;
  if (remainingAmount === undefined) {
    const activeDebts = await paymentPlansRepo.getActiveDebtsForUser(userId, true);
    remainingAmount = round2(activeDebts.reduce((sum, d) => sum + d.loan_amount, 0));
  } else {
    remainingAmount = round2(remainingAmount);
  }

  const saved = await paymentPlansRepo.upsertPaymentPlan(userId, {
    strategy,
    order,
    extraMonthlyBudget: round2(extraMonthlyBudget),
    remainingAmount
  });

  return saved;
}

/**
 * Retrieve active payment plan and sorted debts for a user
 * @param {number} userId 
 */
async function getActivePaymentPlan(userId) {
  const plan = await paymentPlansRepo.getActivePaymentPlan(userId);
  const rawDebts = await paymentPlansRepo.getActiveDebtsForUser(userId, true);

  const activeDebts = rawDebts.map(d => ({
    ...d,
    monthlyPayment: calculateMonthlyPayment(
      d.loan_amount,
      d.interest_rate,
      d.installmentsLeft || d.numberOfInstallments || 1
    )
  }));

  if (!plan) {
    return {
      plan: null,
      activeDebts
    };
  }

  const strategyTitles = {
    AVALANCHE: 'Método Avalancha',
    SNOWBALL: 'Método Bola de Nieve',
    TSUNAMI: 'Método Tsunami',
    CONSOLIDATION: 'Consolidación de Deuda',
    SNOWFLAKE: 'Copos de Nieve'
  };

  // Sort debts according to plan.order
  const orderMap = new Map();
  if (Array.isArray(plan.order)) {
    plan.order.forEach((id, idx) => orderMap.set(Number(id), idx));
  }

  const sortedDebts = [...activeDebts].sort((a, b) => {
    const idxA = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
    const idxB = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
    return idxA - idxB;
  });

  const totalBaseInstallments = round2(sortedDebts.reduce((sum, d) => sum + d.monthlyPayment, 0));
  const extraMonthlyBudget = round2(plan.extraMonthlyBudget || 0);
  const monthlyFreedomCommitment = round2(totalBaseInstallments + extraMonthlyBudget);

  const sequence = sortedDebts.map((d, idx) => ({
    priority: idx + 1,
    debtId: d.id,
    name: d.name || d.category_name || 'Obligación Financiera',
    category_name: d.category_name || null,
    loan_amount: round2(d.loan_amount),
    interest_rate: round2(d.interest_rate),
    monthlyPayment: round2(d.monthlyPayment)
  }));

  const priorityDebt = sequence.length > 0
    ? {
        id: sequence[0].debtId,
        name: sequence[0].name,
        loan_amount: sequence[0].loan_amount,
        monthlyPayment: sequence[0].monthlyPayment
      }
    : null;

  const strategyTitle = strategyTitles[plan.strategy] || plan.strategy;
  let monthlyInstruction = '';
  if (sequence.length === 0) {
    monthlyInstruction = 'No tienes obligaciones financieras activas pendientes por pagar.';
  } else if (extraMonthlyBudget > 0) {
    monthlyInstruction = `Para cumplir con tu objetivo de libertad financiera mediante el ${strategyTitle}, este mes debes destinar $${monthlyFreedomCommitment.toLocaleString('es-CO')} a tus deudas: $${totalBaseInstallments.toLocaleString('es-CO')} para cubrir las cuotas mínimas y $${extraMonthlyBudget.toLocaleString('es-CO')} como ataque acelerado a tu deuda prioritaria: "${priorityDebt.name}".`;
  } else {
    monthlyInstruction = `Para mantener tus créditos al día mediante el ${strategyTitle}, este mes debes destinar $${totalBaseInstallments.toLocaleString('es-CO')} para cubrir las cuotas mínimas pactadas. Si logras aportar un presupuesto extra adicional, acelerarás la liquidación de tu deuda prioritaria: "${priorityDebt.name}".`;
  }

  return {
    plan: {
      ...plan,
      strategyTitle,
      order: plan.order,
      sequence,
      monthlyFreedomCommitment,
      totalBaseInstallments,
      priorityDebt,
      monthlyInstruction
    },
    activeDebts: sortedDebts
  };
}

module.exports = {
  comparePaymentStrategies,
  selectPaymentPlan,
  getActivePaymentPlan,
  calculateMonthlyPayment,
  simulateCascade,
  invalidateCache,
  ValidationError,
  NotFoundError,
  ForbiddenError
};
