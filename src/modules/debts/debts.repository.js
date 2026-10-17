const db = require('../../shared/database/db');

function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

function calculateMonthlyInstallment(amount, ea, n) {
  const p = Number(amount) || 0;
  const rate = Number(ea) || 0;
  const terms = Math.max(1, Number(n) || 1);
  if (p <= 0) return 0;
  if (rate <= 0) return round2(p / terms);
  const im = Math.pow(1 + rate / 100, 1 / 12) - 1;
  const payment = p * (im / (1 - Math.pow(1 + im, -terms)));
  return round2(payment);
}

function enrichWithMonthlyPayment(debt) {
  if (!debt) return null;
  const n = debt.installmentsLeft !== undefined && debt.installmentsLeft !== null
    ? debt.installmentsLeft
    : debt.numberOfInstallments;
  const monthlyPayment = calculateMonthlyInstallment(debt.loan_amount, debt.interest_rate, n);
  return {
    ...debt,
    monthlyPayment
  };
}

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
 * Fetch category by ID to verify existence and ownership
 * @param {number} categoryId 
 */
async function getCategoryById(categoryId) {
  const text = `
    SELECT id, name, user_id, family_id
    FROM finances.categories
    WHERE id = $1;
  `;
  const res = await db.query(text, [categoryId]);
  return res.rows[0] || null;
}

/**
 * Insert a new debt record in finances.debt
 * @param {Object} data 
 */
async function createDebt({
  user_id,
  category_id,
  family_id = null,
  name,
  loan_amount,
  interest_rate,
  numberOfInstallments,
  installmentsLeft,
  begin_date,
  status = true
}) {
  const text = `
    WITH inserted AS (
      INSERT INTO finances.debt (
        user_id,
        category_id,
        family_id,
        name,
        loan_amount,
        interest_rate,
        numberofinstallments,
        installmentsleft,
        begin_date,
        status,
        created_at
      )
      VALUES ($1, $2, $3, COALESCE($4, 'Obligación Financiera'), $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    )
    SELECT
      i.id::int,
      i.user_id::int,
      i.category_id::int,
      c.name AS category_name,
      i.family_id::int,
      COALESCE(i.name, 'Obligación Financiera') AS name,
      i.loan_amount::float,
      i.interest_rate::float,
      i.numberofinstallments AS "numberOfInstallments",
      i.installmentsleft AS "installmentsLeft",
      TO_CHAR(i.begin_date, 'YYYY-MM-DD') AS begin_date,
      i.status,
      i.created_at,
      i.updated_at
    FROM inserted i
    LEFT JOIN finances.categories c ON i.category_id = c.id;
  `;

  const values = [
    user_id,
    category_id,
    family_id,
    name || null,
    loan_amount,
    interest_rate,
    numberOfInstallments,
    installmentsLeft !== undefined ? installmentsLeft : numberOfInstallments,
    begin_date,
    status
  ];

  const res = await db.query(text, values);
  return enrichWithMonthlyPayment(res.rows[0]);
}

/**
 * List debts with optional filters
 * @param {{ user_id?: number, category_id?: number, status?: boolean, family_id?: number }} filters 
 */
async function listDebts(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.user_id !== undefined) {
    values.push(filters.user_id);
    conditions.push(`(
      d.user_id = $${values.length}
      OR (
        d.family_id IS NOT NULL 
        AND d.family_id = (SELECT family_core FROM finances.users WHERE id = $${values.length})
      )
      OR (
        d.user_id IN (
          SELECT id FROM finances.users 
          WHERE family_core IS NOT NULL 
            AND family_core = (SELECT family_core FROM finances.users WHERE id = $${values.length})
        )
      )
    )`);
  }

  if (filters.category_id !== undefined) {
    values.push(filters.category_id);
    conditions.push(`d.category_id = $${values.length}`);
  }

  if (filters.status !== undefined) {
    values.push(filters.status);
    conditions.push(`d.status = $${values.length}`);
  }

  if (filters.family_id !== undefined) {
    values.push(filters.family_id);
    conditions.push(`d.family_id = $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const text = `
    SELECT
      d.id::int,
      d.user_id::int,
      d.category_id::int,
      c.name AS category_name,
      d.family_id::int,
      COALESCE(d.name, 'Obligación Financiera') AS name,
      d.loan_amount::float,
      d.interest_rate::float,
      d.numberofinstallments AS "numberOfInstallments",
      d.installmentsleft AS "installmentsLeft",
      TO_CHAR(d.begin_date, 'YYYY-MM-DD') AS begin_date,
      d.status,
      d.created_at,
      d.updated_at
    FROM finances.debt d
    LEFT JOIN finances.categories c ON d.category_id = c.id
    ${whereClause}
    ORDER BY d.begin_date DESC, d.id DESC;
  `;

  const res = await db.query(text, values);
  return res.rows.map(enrichWithMonthlyPayment);
}

/**
 * Get single debt by ID
 * @param {number} id 
 */
async function getDebtById(id) {
  const text = `
    SELECT
      d.id::int,
      d.user_id::int,
      d.category_id::int,
      c.name AS category_name,
      d.family_id::int,
      COALESCE(d.name, 'Obligación Financiera') AS name,
      d.loan_amount::float,
      d.interest_rate::float,
      d.numberofinstallments AS "numberOfInstallments",
      d.installmentsleft AS "installmentsLeft",
      TO_CHAR(d.begin_date, 'YYYY-MM-DD') AS begin_date,
      d.status,
      d.created_at,
      d.updated_at
    FROM finances.debt d
    LEFT JOIN finances.categories c ON d.category_id = c.id
    WHERE d.id = $1;
  `;

  const res = await db.query(text, [id]);
  return enrichWithMonthlyPayment(res.rows[0]) || null;
}

/**
 * Update debt record by ID
 * @param {number} id 
 * @param {Object} updateData 
 */
async function updateDebt(id, updateData) {
  const setClauses = [];
  const values = [];

  const mapping = {
    name: 'name',
    category_id: 'category_id',
    loan_amount: 'loan_amount',
    interest_rate: 'interest_rate',
    numberOfInstallments: 'numberofinstallments',
    installmentsLeft: 'installmentsleft',
    begin_date: 'begin_date',
    status: 'status',
    family_id: 'family_id'
  };

  for (const [key, col] of Object.entries(mapping)) {
    if (updateData[key] !== undefined) {
      values.push(updateData[key]);
      setClauses.push(`${col} = $${values.length}`);
    }
  }

  setClauses.push('updated_at = NOW()');
  values.push(id);

  const text = `
    WITH updated AS (
      UPDATE finances.debt
      SET ${setClauses.join(', ')}
      WHERE id = $${values.length}
      RETURNING *
    )
    SELECT
      u.id::int,
      u.user_id::int,
      u.category_id::int,
      c.name AS category_name,
      u.family_id::int,
      COALESCE(u.name, 'Obligación Financiera') AS name,
      u.loan_amount::float,
      u.interest_rate::float,
      u.numberofinstallments AS "numberOfInstallments",
      u.installmentsleft AS "installmentsLeft",
      TO_CHAR(u.begin_date, 'YYYY-MM-DD') AS begin_date,
      u.status,
      u.created_at,
      u.updated_at
    FROM updated u
    LEFT JOIN finances.categories c ON u.category_id = c.id;
  `;

  const res = await db.query(text, values);
  return enrichWithMonthlyPayment(res.rows[0]) || null;
}

/**
 * Delete debt record by ID
 * @param {number} id 
 */
async function deleteDebt(id) {
  const text = `
    DELETE FROM finances.debt
    WHERE id = $1
    RETURNING id::int;
  `;

  const res = await db.query(text, [id]);
  return Boolean(res.rows[0]);
}

/**
 * Record a payment on a debt and update debt balance within an ACID transaction
 * @param {{
 *   debtId: number,
 *   userId: number,
 *   amount: number,
 *   paymentDate: string,
 *   newBalance: number,
 *   newInstallmentsLeft: number,
 *   isFullyPaid: boolean
 * }} params
 */
async function recordDebtPayment({
  debtId,
  userId,
  amount,
  paymentDate,
  newBalance,
  newInstallmentsLeft,
  isFullyPaid
}) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert payment record
    const insertPaymentText = `
      INSERT INTO finances.debt_payment (debt_id, user_id, amount, payment_date, created_at)
      VALUES ($1, $2, $3, $4::date, NOW())
      RETURNING
        id::int,
        debt_id::int,
        user_id::int,
        amount::float,
        TO_CHAR(payment_date, 'YYYY-MM-DD') AS payment_date,
        created_at;
    `;
    const paymentRes = await client.query(insertPaymentText, [debtId, userId, amount, paymentDate]);
    const payment = paymentRes.rows[0];

    // 2. Update debt balance, installments and status
    const updateDebtText = `
      WITH updated AS (
        UPDATE finances.debt
        SET
          loan_amount = $1,
          installmentsleft = $2,
          status = $3,
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      )
      SELECT
        u.id::int,
        u.user_id::int,
        u.category_id::int,
        c.name AS category_name,
        u.family_id::int,
        COALESCE(u.name, 'Obligación Financiera') AS name,
        u.loan_amount::float,
        u.interest_rate::float,
        u.numberofinstallments AS "numberOfInstallments",
        u.installmentsleft AS "installmentsLeft",
        TO_CHAR(u.begin_date, 'YYYY-MM-DD') AS begin_date,
        u.status,
        u.created_at,
        u.updated_at
      FROM updated u
      LEFT JOIN finances.categories c ON u.category_id = c.id;
    `;
    const debtRes = await client.query(updateDebtText, [
      newBalance,
      newInstallmentsLeft,
      !isFullyPaid,
      debtId
    ]);
    const updatedDebt = enrichWithMonthlyPayment(debtRes.rows[0]);

    await client.query('COMMIT');

    return {
      payment,
      debt: updatedDebt
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get payment history for a debt
 * @param {number} debtId 
 */
async function getDebtPayments(debtId) {
  const text = `
    SELECT
      id::int,
      debt_id::int,
      user_id::int,
      amount::float,
      TO_CHAR(payment_date, 'YYYY-MM-DD') AS payment_date,
      created_at
    FROM finances.debt_payment
    WHERE debt_id = $1
    ORDER BY payment_date DESC, id DESC;
  `;
  const res = await db.query(text, [debtId]);
  return res.rows;
}

module.exports = {
  checkUserExists,
  getCategoryById,
  createDebt,
  listDebts,
  getDebtById,
  updateDebt,
  deleteDebt,
  recordDebtPayment,
  getDebtPayments,
  calculateMonthlyInstallment,
  enrichWithMonthlyPayment
};
