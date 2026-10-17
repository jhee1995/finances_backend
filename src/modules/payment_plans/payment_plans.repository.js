const db = require('../../shared/database/db');

/**
 * Fetch active debts for a user (and optionally household family debts)
 * @param {number} userId 
 * @param {boolean} includeFamily 
 */
async function getActiveDebtsForUser(userId, includeFamily = true) {
  const values = [userId];
  let condition;

  if (includeFamily) {
    condition = `(
      d.user_id = $1
      OR (
        d.family_id IS NOT NULL 
        AND d.family_id = (SELECT family_core FROM finances.users WHERE id = $1)
      )
      OR (
        d.user_id IN (
          SELECT id FROM finances.users 
          WHERE family_core IS NOT NULL 
            AND family_core = (SELECT family_core FROM finances.users WHERE id = $1)
        )
      )
    )`;
  } else {
    condition = `d.user_id = $1`;
  }

  const text = `
    SELECT
      d.id::int,
      COALESCE(NULLIF(TRIM(d.name), ''), c.name, 'Obligación Financiera') AS name,
      d.user_id::int,
      d.category_id::int,
      c.name AS category_name,
      d.family_id::int,
      d.loan_amount::float,
      d.interest_rate::float,
      d.numberofinstallments AS "numberOfInstallments",
      d.installmentsleft AS "installmentsLeft",
      TO_CHAR(d.begin_date, 'YYYY-MM-DD') AS begin_date,
      d.status,
      d.created_at
    FROM finances.debt d
    LEFT JOIN finances.categories c ON d.category_id = c.id
    WHERE ${condition}
      AND d.status = true
    ORDER BY d.id ASC;
  `;

  const res = await db.query(text, values);
  return res.rows;
}

/**
 * Persist or update the selected payment plan for a user
 * @param {number} userId 
 * @param {Object} planData 
 */
async function upsertPaymentPlan(userId, { strategy, order, extraMonthlyBudget = 0, remainingAmount = 0 }) {
  // Check if user already has a saved plan
  const checkRes = await db.query(
    'SELECT id FROM finances.payment_plan WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
    [userId]
  );

  let queryText;
  let queryValues;

  if (checkRes.rows[0]) {
    const existingId = checkRes.rows[0].id;
    queryText = `
      UPDATE finances.payment_plan
      SET
        strategy = $1,
        "order" = $2,
        remainingamount = $3,
        extra_monthly_budget = $4,
        updated_at = NOW()
      WHERE id = $5
      RETURNING
        id::int,
        user_id::int,
        strategy,
        "order",
        remainingamount::float,
        extra_monthly_budget::float AS "extraMonthlyBudget",
        created_at,
        updated_at;
    `;
    queryValues = [strategy, order, remainingAmount, extraMonthlyBudget, existingId];
  } else {
    queryText = `
      INSERT INTO finances.payment_plan (
        user_id,
        strategy,
        "order",
        remainingamount,
        extra_monthly_budget,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING
        id::int,
        user_id::int,
        strategy,
        "order",
        remainingamount::float,
        extra_monthly_budget::float AS "extraMonthlyBudget",
        created_at,
        updated_at;
    `;
    queryValues = [userId, strategy, order, remainingAmount, extraMonthlyBudget];
  }

  const res = await db.query(queryText, queryValues);
  const row = res.rows[0];
  if (!row) return null;
  return {
    ...row,
    order: Array.isArray(row.order) ? row.order.map(Number) : []
  };
}

/**
 * Fetch current active payment plan for a user
 * @param {number} userId 
 */
async function getActivePaymentPlan(userId) {
  const text = `
    SELECT
      id::int,
      user_id::int AS "userId",
      strategy,
      "order",
      remainingamount::float AS "remainingAmount",
      extra_monthly_budget::float AS "extraMonthlyBudget",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM finances.payment_plan
    WHERE user_id = $1
    ORDER BY updated_at DESC, id DESC
    LIMIT 1;
  `;
  const res = await db.query(text, [userId]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    ...row,
    order: Array.isArray(row.order) ? row.order.map(Number) : []
  };
}

module.exports = {
  getActiveDebtsForUser,
  upsertPaymentPlan,
  getActivePaymentPlan
};
