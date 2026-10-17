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
 * Find an income by its ID in finances.cashflow
 * @param {number} id 
 */
async function findById(id) {
  const text = `
    SELECT 
      id,
      user_id,
      COALESCE(name, 'Ingreso registrado') AS name,
      incomeamount::float AS income_amount,
      TO_CHAR(date, 'YYYY-MM-DD') AS date,
      created_at,
      updated_at
    FROM finances.cashflow
    WHERE id = $1;
  `;
  const res = await db.query(text, [id]);
  return res.rows[0] || null;
}

/**
 * Find all incomes with optional filters (user_id, start_date, end_date)
 * @param {{ user_id?: number, start_date?: string, end_date?: string }} filters 
 */
async function findAll(filters = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (filters.user_id !== undefined) {
    conditions.push(`user_id = $${paramIndex}`);
    params.push(filters.user_id);
    paramIndex++;
  }

  if (filters.start_date !== undefined) {
    conditions.push(`date >= $${paramIndex}::date`);
    params.push(filters.start_date);
    paramIndex++;
  }

  if (filters.end_date !== undefined) {
    conditions.push(`date <= $${paramIndex}::date`);
    params.push(filters.end_date);
    paramIndex++;
  }

  let text = `
    SELECT 
      id,
      user_id,
      COALESCE(name, 'Ingreso registrado') AS name,
      incomeamount::float AS income_amount,
      TO_CHAR(date, 'YYYY-MM-DD') AS date,
      created_at,
      updated_at
    FROM finances.cashflow
  `;

  if (conditions.length > 0) {
    text += ` WHERE ${conditions.join(' AND ')}`;
  }

  text += ` ORDER BY date DESC, id DESC LIMIT 200;`;

  const res = await db.query(text, params);
  return res.rows;
}

/**
 * Create a new income entry in finances.cashflow
 * @param {{ user_id: number, income_amount: number, date: string, name?: string }} data 
 */
async function create(data) {
  const text = `
    INSERT INTO finances.cashflow (user_id, incomeamount, date, name)
    VALUES ($1, $2, $3::date, $4)
    RETURNING 
      id,
      user_id,
      COALESCE(name, 'Ingreso registrado') AS name,
      incomeamount::float AS income_amount,
      TO_CHAR(date, 'YYYY-MM-DD') AS date,
      created_at;
  `;
  const res = await db.query(text, [
    data.user_id,
    data.income_amount,
    data.date,
    data.name ? data.name.trim() : 'Ingreso registrado'
  ]);
  return res.rows[0];
}

/**
 * Update an existing income entry in finances.cashflow
 * @param {number} id 
 * @param {{ user_id?: number, income_amount?: number, date?: string, name?: string }} data 
 */
async function update(id, data) {
  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (data.user_id !== undefined) {
    updates.push(`user_id = $${paramIndex}`);
    params.push(data.user_id);
    paramIndex++;
  }

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    params.push(data.name.trim());
    paramIndex++;
  }

  if (data.income_amount !== undefined) {
    updates.push(`incomeamount = $${paramIndex}`);
    params.push(data.income_amount);
    paramIndex++;
  }

  if (data.date !== undefined) {
    updates.push(`date = $${paramIndex}::date`);
    params.push(data.date);
    paramIndex++;
  }

  updates.push(`updated_at = now()`);

  params.push(id);
  const text = `
    UPDATE finances.cashflow
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING 
      id,
      user_id,
      COALESCE(name, 'Ingreso registrado') AS name,
      incomeamount::float AS income_amount,
      TO_CHAR(date, 'YYYY-MM-DD') AS date,
      created_at,
      updated_at;
  `;

  const res = await db.query(text, params);
  return res.rows[0] || null;
}

/**
 * Remove an income entry by ID from finances.cashflow
 * @param {number} id 
 */
async function remove(id) {
  const text = `
    DELETE FROM finances.cashflow
    WHERE id = $1
    RETURNING id;
  `;
  const res = await db.query(text, [id]);
  return res.rows[0] || null;
}

module.exports = {
  checkUserExists,
  findById,
  findAll,
  create,
  update,
  remove
};
