const db = require('../../shared/database/db');

/**
 * Fetch user's family core ID
 * @param {number} userId 
 */
async function getUserFamilyCore(userId) {
  const text = `SELECT family_core::int AS family_core FROM finances.users WHERE id = $1;`;
  const res = await db.query(text, [userId]);
  return res.rows[0]?.family_core ? Number(res.rows[0].family_core) : null;
}

/**
 * Check if category exists
 * @param {number} categoryId 
 */
async function getCategory(categoryId) {
  const text = `SELECT id::int AS id, name FROM finances.categories WHERE id = $1;`;
  const res = await db.query(text, [categoryId]);
  return res.rows[0] || null;
}

/**
 * Create a new recurring obligation
 */
async function createObligation(data) {
  const text = `
    INSERT INTO finances.recurring_obligations (
      user_id,
      category_id,
      name,
      amount,
      frequency,
      due_day,
      due_day_secondary,
      is_family,
      notes,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
    RETURNING 
      id::int AS id,
      user_id::int AS user_id,
      category_id::int AS category_id,
      name,
      amount::float,
      frequency,
      due_day,
      due_day_secondary,
      is_family,
      notes,
      status,
      created_at,
      updated_at;
  `;
  const params = [
    data.user_id,
    data.category_id,
    data.name,
    data.amount,
    data.frequency,
    data.due_day,
    data.due_day_secondary || null,
    Boolean(data.is_family),
    data.notes || null
  ];

  const res = await db.query(text, params);
  return res.rows[0];
}

/**
 * Find recurring obligation by ID
 */
async function findById(id) {
  const text = `
    SELECT 
      ro.id::int AS id,
      ro.user_id::int AS user_id,
      ro.category_id::int AS category_id,
      c.name AS category_name,
      ro.name,
      ro.amount::float,
      ro.frequency,
      ro.due_day,
      ro.due_day_secondary,
      ro.is_family,
      ro.notes,
      ro.status,
      ro.created_at,
      ro.updated_at
    FROM finances.recurring_obligations ro
    LEFT JOIN finances.categories c ON ro.category_id = c.id
    WHERE ro.id = $1;
  `;
  const res = await db.query(text, [id]);
  return res.rows[0] || null;
}

/**
 * List obligations with user/family filters
 */
async function listObligations({ userId, familyCoreId, includeFamily = false, status = 'ACTIVE' }) {
  let text = `
    SELECT 
      ro.id::int AS id,
      ro.user_id::int AS user_id,
      ro.category_id::int AS category_id,
      c.name AS category_name,
      ro.name,
      ro.amount::float,
      ro.frequency,
      ro.due_day,
      ro.due_day_secondary,
      ro.is_family,
      ro.notes,
      ro.status,
      ro.created_at,
      ro.updated_at
    FROM finances.recurring_obligations ro
    LEFT JOIN finances.categories c ON ro.category_id = c.id
    WHERE 1=1
  `;
  const params = [];
  let pIdx = 1;

  if (includeFamily && familyCoreId) {
    text += ` AND (ro.user_id = $${pIdx} OR (ro.is_family = true AND ro.user_id IN (SELECT id FROM finances.users WHERE family_core = $${pIdx + 1})))`;
    params.push(userId, familyCoreId);
    pIdx += 2;
  } else if (userId) {
    text += ` AND ro.user_id = $${pIdx}`;
    params.push(userId);
    pIdx++;
  }

  if (status && status !== 'ALL') {
    text += ` AND ro.status = $${pIdx}`;
    params.push(status);
    pIdx++;
  }

  text += ` ORDER BY ro.due_day ASC, ro.id ASC;`;

  const res = await db.query(text, params);
  return res.rows;
}

/**
 * Find payments for a specific period
 */
async function findPeriodPayments(obligationIds, year, month, cycle = null) {
  if (!obligationIds || obligationIds.length === 0) return [];

  let text = `
    SELECT 
      id::int AS payment_id,
      obligation_id::int AS obligation_id,
      user_id::int AS user_id,
      amount::float AS actual_amount,
      TO_CHAR(payment_date, 'YYYY-MM-DD') AS payment_date,
      period_year,
      period_month,
      period_cycle,
      expense_id::int AS expense_id,
      notes,
      created_at
    FROM finances.recurring_obligation_payments
    WHERE obligation_id = ANY($1)
      AND period_year = $2
      AND period_month = $3
  `;
  const params = [obligationIds, year, month];

  if (cycle !== null && cycle !== undefined) {
    text += ` AND period_cycle = $4`;
    params.push(cycle);
  }

  const res = await db.query(text, params);
  return res.rows;
}

/**
 * Check if an obligation payment already exists for the given cycle
 */
async function findExistingPayment(obligationId, year, month, cycle = 1) {
  const text = `
    SELECT id::int AS id, expense_id::int AS expense_id, amount::float, payment_date
    FROM finances.recurring_obligation_payments
    WHERE obligation_id = $1 AND period_year = $2 AND period_month = $3 AND period_cycle = $4;
  `;
  const res = await db.query(text, [obligationId, year, month, cycle]);
  return res.rows[0] || null;
}

/**
 * Atomic transaction to pay a recurring obligation and record expense in finances.outcome
 */
async function payObligationAtomic({
  obligation,
  userId,
  paymentDate,
  actualAmount,
  periodYear,
  periodMonth,
  periodCycle,
  notes
}) {
  const pool = db.pool;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Double check conflict inside transaction with row-level lock on obligation
    const checkSql = `
      SELECT id FROM finances.recurring_obligation_payments
      WHERE obligation_id = $1 AND period_year = $2 AND period_month = $3 AND period_cycle = $4
      FOR UPDATE;
    `;
    const checkRes = await client.query(checkSql, [obligation.id, periodYear, periodMonth, periodCycle]);
    if (checkRes.rows.length > 0) {
      const err = new Error('La obligación ya se encuentra registrada como pagada para este ciclo');
      err.code = 'CONFLICT';
      throw err;
    }

    // 1. Insert into finances.outcome
    const outcomeSql = `
      INSERT INTO finances.outcome (
        user_id,
        category_id,
        name,
        incomeamount,
        date,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id::int AS id, user_id::int AS user_id, category_id::int AS category_id, name, incomeamount::float AS amount, TO_CHAR(date, 'YYYY-MM-DD') AS date;
    `;
    const outcomeRes = await client.query(outcomeSql, [
      userId,
      obligation.category_id,
      obligation.name,
      actualAmount,
      paymentDate
    ]);
    const createdExpense = outcomeRes.rows[0];

    // 2. Insert into finances.recurring_obligation_payments
    const paymentSql = `
      INSERT INTO finances.recurring_obligation_payments (
        obligation_id,
        user_id,
        expense_id,
        amount,
        payment_date,
        period_year,
        period_month,
        period_cycle,
        notes,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING 
        id::int AS id,
        obligation_id::int AS obligation_id,
        user_id::int AS user_id,
        amount::float,
        TO_CHAR(payment_date, 'YYYY-MM-DD') AS payment_date,
        period_year,
        period_month,
        period_cycle,
        expense_id::int AS expense_id,
        notes,
        created_at;
    `;
    const paymentRes = await client.query(paymentSql, [
      obligation.id,
      userId,
      createdExpense.id,
      actualAmount,
      paymentDate,
      periodYear,
      periodMonth,
      periodCycle,
      notes || null
    ]);
    const createdPayment = paymentRes.rows[0];

    await client.query('COMMIT');

    return {
      payment: createdPayment,
      expense: createdExpense
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Remove or deactivate obligation
 */
async function removeObligation(id) {
  const text = `
    UPDATE finances.recurring_obligations
    SET status = 'INACTIVE', updated_at = NOW()
    WHERE id = $1
    RETURNING id::int AS id, status;
  `;
  const res = await db.query(text, [id]);
  return res.rows[0] || null;
}

module.exports = {
  getUserFamilyCore,
  getCategory,
  createObligation,
  findById,
  listObligations,
  findPeriodPayments,
  findExistingPayment,
  payObligationAtomic,
  removeObligation
};
