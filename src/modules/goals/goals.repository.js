const db = require('../../shared/database/db');

/**
 * Maps raw database row into contract goal object
 * @param {Object} row 
 */
function mapGoalRow(row) {
  if (!row) return null;

  const targetAmount = Number(row.amount) || 0;
  const currentAmount = Number(row.current_amount) || 0;
  const progressPercent = targetAmount > 0 
    ? Math.min(100, Math.round(((currentAmount / targetAmount) * 100) * 100) / 100)
    : 0;
  const remainingAmount = Math.max(0, targetAmount - currentAmount);

  let linkedDebt = null;
  if (row.debtid && row.debt_loan_amount !== undefined && row.debt_loan_amount !== null) {
    const loanAmount = Number(row.debt_loan_amount) || 0;
    const interestRate = Number(row.debt_interest_rate) || 0;
    const numberOfInstallments = Number(row.debt_number_of_installments) || 0;
    const installmentsLeft = Number(row.debt_installments_left) || 0;
    const amortizedPercent = numberOfInstallments > 0
      ? Math.min(100, Math.round((((numberOfInstallments - installmentsLeft) / numberOfInstallments) * 100) * 100) / 100)
      : 0;

    linkedDebt = {
      id: Number(row.debtid),
      loanAmount,
      interestRate,
      numberOfInstallments,
      installmentsLeft,
      amortizedPercent
    };
  }

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    goalName: row.goalname,
    amount: targetAmount,
    currentAmount,
    progressPercent,
    remainingAmount,
    targetDate: row.target_date ? (row.target_date.toISOString ? row.target_date.toISOString().split('T')[0] : String(row.target_date).slice(0, 10)) : null,
    isDebt: Boolean(row.isdebt),
    debtId: row.debtid ? Number(row.debtid) : null,
    linkedDebt,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
  };
}

/**
 * Check if a debt exists and whether it belongs to the given user or their family
 * @param {number} debtId 
 * @param {number} userId 
 */
async function checkDebtAccess(debtId, userId) {
  const query = `
    SELECT d.id, d.user_id, d.loan_amount, d.interest_rate, d.numberofinstallments, d.installmentsleft,
           u.family_core AS debt_family_core,
           (SELECT family_core FROM finances.users WHERE id = $2) AS user_family_core
    FROM finances.debt d
    LEFT JOIN finances.users u ON d.user_id = u.id
    WHERE d.id = $1;
  `;
  const res = await db.query(query, [debtId, userId]);
  if (!res.rows[0]) return { exists: false, hasAccess: false, debt: null };

  const row = res.rows[0];
  const isOwner = Number(row.user_id) === Number(userId);
  const isFamily = Boolean(row.debt_family_core && row.user_family_core && Number(row.debt_family_core) === Number(row.user_family_core));

  return {
    exists: true,
    hasAccess: isOwner || isFamily,
    debt: row
  };
}

/**
 * Insert a new goal in finances.goals
 */
async function createGoal({
  userId,
  goalName,
  amount,
  currentAmount = 0,
  targetDate = null,
  isDebt = false,
  debtId = null
}) {
  const insertQuery = `
    INSERT INTO finances.goals (
      user_id, goalname, amount, current_amount, target_date, isdebt, debtid, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id;
  `;
  const insertRes = await db.query(insertQuery, [
    userId,
    goalName,
    amount,
    currentAmount,
    targetDate,
    isDebt,
    isDebt ? debtId : null
  ]);

  return getGoalById(insertRes.rows[0].id);
}

/**
 * Retrieve a goal by ID enriched with linked debt information
 * @param {number} id 
 */
async function getGoalById(id) {
  const query = `
    SELECT g.id, g.user_id, g.goalname, g.amount, g.current_amount, g.target_date, g.isdebt, g.debtid,
           g.created_at, g.updated_at,
           d.loan_amount AS debt_loan_amount,
           d.interest_rate AS debt_interest_rate,
           d.numberofinstallments AS debt_number_of_installments,
           d.installmentsleft AS debt_installments_left,
           u.family_core AS user_family_core
    FROM finances.goals g
    LEFT JOIN finances.debt d ON g.debtid = d.id
    LEFT JOIN finances.users u ON g.user_id = u.id
    WHERE g.id = $1;
  `;
  const res = await db.query(query, [id]);
  if (!res.rows[0]) return null;
  return mapGoalRow(res.rows[0]);
}

/**
 * Retrieve all goals for a user (or user + family)
 * @param {number} userId 
 * @param {{ includeFamily: boolean }} options 
 */
async function getGoalsByUser(userId, { includeFamily = false } = {}) {
  let query = `
    SELECT g.id, g.user_id, g.goalname, g.amount, g.current_amount, g.target_date, g.isdebt, g.debtid,
           g.created_at, g.updated_at,
           d.loan_amount AS debt_loan_amount,
           d.interest_rate AS debt_interest_rate,
           d.numberofinstallments AS debt_number_of_installments,
           d.installmentsleft AS debt_installments_left
    FROM finances.goals g
    LEFT JOIN finances.debt d ON g.debtid = d.id
  `;

  const values = [];
  if (userId) {
    if (includeFamily) {
      values.push(userId);
      query += `
        WHERE (
          g.user_id = $1 
          OR g.user_id IN (
            SELECT id FROM finances.users 
            WHERE family_core IS NOT NULL 
              AND family_core = (SELECT family_core FROM finances.users WHERE id = $1)
          )
        )
      `;
    } else {
      values.push(userId);
      query += ` WHERE g.user_id = $1 `;
    }
  }

  query += ` ORDER BY g.target_date ASC NULLS LAST, g.id DESC; `;

  const res = await db.query(query, values);
  return res.rows.map(mapGoalRow);
}

/**
 * Update a goal by ID
 * @param {number} id 
 * @param {Object} fields 
 */
async function updateGoal(id, fields) {
  const allowedCols = {
    userId: 'user_id',
    goalName: 'goalname',
    amount: 'amount',
    currentAmount: 'current_amount',
    targetDate: 'target_date',
    isDebt: 'isdebt',
    debtId: 'debtid'
  };

  const setClauses = [];
  const values = [];

  for (const [key, value] of Object.entries(fields)) {
    if (allowedCols[key] !== undefined && value !== undefined) {
      values.push(value);
      setClauses.push(`${allowedCols[key]} = $${values.length}`);
    }
  }

  if (setClauses.length === 0) {
    return getGoalById(id);
  }

  setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const query = `
    UPDATE finances.goals
    SET ${setClauses.join(', ')}
    WHERE id = $${values.length}
    RETURNING id;
  `;

  const res = await db.query(query, values);
  if (!res.rows[0]) return null;
  return getGoalById(id);
}

/**
 * Delete a goal by ID
 * @param {number} id 
 */
async function deleteGoal(id) {
  const query = `
    DELETE FROM finances.goals
    WHERE id = $1
    RETURNING id;
  `;
  const res = await db.query(query, [id]);
  return res.rowCount > 0;
}

module.exports = {
  createGoal,
  getGoalById,
  getGoalsByUser,
  updateGoal,
  deleteGoal,
  checkDebtAccess
};
