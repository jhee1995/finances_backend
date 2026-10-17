const dashboardRepo = require('./dashboard.repository');

class ValidationError extends Error {
  constructor(message = 'Error de validación', invalidParams = []) {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
    this.invalid_params = invalidParams;
  }
}

const MONTH_NAMES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];

// In-memory cache for high-throughput resilience (3 seconds TTL)
const cache = new Map();
const CACHE_TTL_MS = 3000;

/**
 * Get consolidated dashboard metrics for a user and year with transversal category execution
 * @param {{ user_id: number, year: number }} params 
 */
async function getDashboardSummary({ user_id, year }) {
  const cacheKey = `${user_id}:${year}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const consolidated = await dashboardRepo.getConsolidatedDashboardData(user_id, year);

  if (!consolidated || !consolidated.user_exists) {
    throw new ValidationError('El usuario especificado no existe', [
      { name: 'user_id', reason: `El usuario con ID ${user_id} no existe en finances.users` }
    ]);
  }

  const monthlyIncomesRaw = consolidated.monthly_incomes || [];
  const monthlyExpensesRaw = consolidated.monthly_expenses || [];
  const monthlyDebtPaymentsRaw = consolidated.monthly_debt_payments || [];
  const categoriesRaw = consolidated.categories || [];
  const categoryExpensesRaw = consolidated.category_expenses || [];
  const categoryDebtsRaw = consolidated.category_debts || [];

  // Build map of incomes and expenses per month & compute totals
  const incomesByMonth = new Map();
  let totalIncomeSum = 0;
  monthlyIncomesRaw.forEach(row => {
    const val = parseFloat(row.total);
    incomesByMonth.set(parseInt(row.month, 10), val);
    totalIncomeSum += val;
  });

  const expensesByMonth = new Map();
  let totalExpensesSum = 0;
  monthlyExpensesRaw.forEach(row => {
    const val = parseFloat(row.total);
    expensesByMonth.set(parseInt(row.month, 10), val);
    totalExpensesSum += val;
  });

  const debtPaymentsByMonth = new Map();
  let totalDebtPaymentsSum = 0;
  monthlyDebtPaymentsRaw.forEach(row => {
    const val = parseFloat(row.total);
    debtPaymentsByMonth.set(parseInt(row.month, 10), val);
    totalDebtPaymentsSum += val;
  });

  const total_income = parseFloat(Number(totalIncomeSum).toFixed(2));
  const total_expenses = parseFloat(Number(totalExpensesSum).toFixed(2));
  const total_debt_payments = parseFloat(Number(totalDebtPaymentsSum).toFixed(2));
  const net_balance = parseFloat((total_income - total_expenses - total_debt_payments).toFixed(2));

  const savings_rate = total_income > 0
    ? parseFloat(((net_balance / total_income) * 100).toFixed(2))
    : 0.0;

  // Construct normalized 12-month series
  const monthly_metrics = MONTH_NAMES.map((month_name, idx) => {
    const month = idx + 1;
    const inc = parseFloat(Number(incomesByMonth.get(month) || 0).toFixed(2));
    const exp = parseFloat(Number(expensesByMonth.get(month) || 0).toFixed(2));
    const debt_pay = parseFloat(Number(debtPaymentsByMonth.get(month) || 0).toFixed(2));
    const bal = parseFloat((inc - exp - debt_pay).toFixed(2));

    return {
      month,
      month_name,
      income: inc,
      expenses: exp,
      debt_payments: debt_pay,
      balance: bal
    };
  });

  // Category-level aggregation maps
  const expByCategory = new Map();
  categoryExpensesRaw.forEach(row => {
    expByCategory.set(Number(row.category_id), parseFloat(row.total));
  });

  const debtsByCategory = new Map();
  categoryDebtsRaw.forEach(row => {
    debtsByCategory.set(Number(row.category_id), parseFloat(row.total_amortized));
  });

  // Calculate transversal category distribution and execution
  const categories_distribution = categoriesRaw.map(cat => {
    const catId = Number(cat.id);
    const pct = Number(cat.percentage) || 0;
    const budgeted_amount = parseFloat(((total_income * pct) / 100).toFixed(2));
    const direct_expenses = parseFloat(Number(expByCategory.get(catId) || 0).toFixed(2));
    const debt_payments = parseFloat(Number(debtsByCategory.get(catId) || 0).toFixed(2));
    const actual_spent = parseFloat((direct_expenses + debt_payments).toFixed(2));

    const execution_percentage = budgeted_amount > 0
      ? parseFloat(((actual_spent / budgeted_amount) * 100).toFixed(2))
      : 0.0;

    const is_overbudget = actual_spent > budgeted_amount;
    const remaining_budget = parseFloat((budgeted_amount - actual_spent).toFixed(2));

    return {
      category_id: parseInt(cat.id, 10),
      name: cat.name,
      percentage: pct,
      allocated_amount: budgeted_amount, // backward compatibility
      budgeted_amount,
      direct_expenses,
      debt_payments,
      actual_spent,
      execution_percentage,
      is_overbudget,
      remaining_budget
    };
  });

  const result = {
    user_id: Number(user_id),
    year: Number(year),
    total_income,
    total_expenses,
    total_debt_payments,
    net_balance,
    savings_rate,
    monthly_metrics,
    categories_distribution
  };

  cache.set(cacheKey, { timestamp: now, data: result });
  return result;
}

module.exports = {
  getDashboardSummary,
  ValidationError,
  _clearCache: () => cache.clear()
};
