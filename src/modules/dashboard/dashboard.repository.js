const db = require('../../shared/database/db');

/**
 * Check if a user exists in finances.users
 * @param {number} userId 
 */
async function checkUserExists(userId) {
  const text = `
    SELECT id
    FROM finances.users
    WHERE id = $1;
  `;
  const res = await db.query(text, [userId]);
  return Boolean(res.rows[0]);
}

/**
 * Get total income for a user in a given year
 * @param {number} userId 
 * @param {number} year 
 */
async function getYearlyIncomesSummary(userId, year) {
  const text = `
    SELECT COALESCE(SUM(incomeamount), 0)::float AS total
    FROM finances.cashflow
    WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2;
  `;
  const res = await db.query(text, [userId, year]);
  return res.rows[0]?.total || 0;
}

/**
 * Get monthly incomes breakdown for a user in a given year
 * @param {number} userId 
 * @param {number} year 
 */
async function getMonthlyIncomes(userId, year) {
  const text = `
    SELECT 
      EXTRACT(MONTH FROM date)::int AS month,
      COALESCE(SUM(incomeamount), 0)::float AS total
    FROM finances.cashflow
    WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2
    GROUP BY EXTRACT(MONTH FROM date);
  `;
  const res = await db.query(text, [userId, year]);
  return res.rows;
}

/**
 * Get total expenses for a user in a given year
 * @param {number} userId 
 * @param {number} year 
 */
async function getYearlyExpensesSummary(userId, year) {
  const text = `
    SELECT COALESCE(SUM(incomeamount), 0)::float AS total
    FROM finances.outcome
    WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2;
  `;
  const res = await db.query(text, [userId, year]);
  return res.rows[0]?.total || 0;
}

/**
 * Get monthly expenses breakdown for a user in a given year
 * @param {number} userId 
 * @param {number} year 
 */
async function getMonthlyExpenses(userId, year) {
  const text = `
    SELECT 
      EXTRACT(MONTH FROM date)::int AS month,
      COALESCE(SUM(incomeamount), 0)::float AS total
    FROM finances.outcome
    WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2
    GROUP BY EXTRACT(MONTH FROM date);
  `;
  const res = await db.query(text, [userId, year]);
  return res.rows;
}

/**
 * Get user categories with assigned percentages
 * @param {number} userId 
 */
async function getUserCategories(userId) {
  const text = `
    SELECT id, name, percentage
    FROM finances.categories
    WHERE user_id = $1
    ORDER BY percentage DESC, id ASC;
  `;
  const res = await db.query(text, [userId]);
  return res.rows;
}

/**
 * Single optimized query fetching all dashboard metrics, monthly series,
 * and category-level expenses and amortized debt payments in one database roundtrip.
 * @param {number} userId 
 * @param {number} year 
 */
async function getConsolidatedDashboardData(userId, year) {
  const text = `
    SELECT 
      (SELECT EXISTS(SELECT 1 FROM finances.users WHERE id = $1)) AS user_exists,
      (
        SELECT COALESCE(json_agg(m), '[]'::json) FROM (
          SELECT EXTRACT(MONTH FROM date)::int AS month, COALESCE(SUM(incomeamount), 0)::float AS total
          FROM finances.cashflow
          WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2
          GROUP BY EXTRACT(MONTH FROM date)
        ) m
      ) AS monthly_incomes,
      (
        SELECT COALESCE(json_agg(e), '[]'::json) FROM (
          SELECT EXTRACT(MONTH FROM date)::int AS month, COALESCE(SUM(incomeamount), 0)::float AS total
          FROM finances.outcome
          WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2
          GROUP BY EXTRACT(MONTH FROM date)
        ) e
      ) AS monthly_expenses,
      (
        SELECT COALESCE(json_agg(p), '[]'::json) FROM (
          SELECT EXTRACT(MONTH FROM payment_date)::int AS month, COALESCE(SUM(amount), 0)::float AS total
          FROM finances.debt_payment
          WHERE user_id = $1 AND EXTRACT(YEAR FROM payment_date) = $2
          GROUP BY EXTRACT(MONTH FROM payment_date)
        ) p
      ) AS monthly_debt_payments,
      (
        SELECT COALESCE(json_agg(c), '[]'::json) FROM (
          SELECT id, name, percentage
          FROM finances.categories
          WHERE user_id = $1
          ORDER BY percentage DESC, id ASC
        ) c
      ) AS categories,
      (
        SELECT COALESCE(json_agg(ce), '[]'::json) FROM (
          SELECT category_id, COALESCE(SUM(incomeamount), 0)::float AS total
          FROM finances.outcome
          WHERE user_id = $1 AND category_id IS NOT NULL AND EXTRACT(YEAR FROM date) = $2
          GROUP BY category_id
        ) ce
      ) AS category_expenses,
      (
        SELECT COALESCE(json_agg(cd), '[]'::json) FROM (
          SELECT 
            category_id, 
            COALESCE(SUM(
              CASE 
                WHEN numberofinstallments > 0 AND installmentsleft >= 0 AND numberofinstallments >= installmentsleft
                THEN (numberofinstallments - installmentsleft) * (loan_amount / numberofinstallments)
                ELSE 0 
              END
            ), 0)::float AS total_amortized
          FROM finances.debt
          WHERE user_id = $1 AND category_id IS NOT NULL
          GROUP BY category_id
        ) cd
      ) AS category_debts;
  `;
  const res = await db.query(text, [userId, year]);
  return res.rows[0];
}

module.exports = {
  checkUserExists,
  getYearlyIncomesSummary,
  getMonthlyIncomes,
  getYearlyExpensesSummary,
  getMonthlyExpenses,
  getUserCategories,
  getConsolidatedDashboardData
};
