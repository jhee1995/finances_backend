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
 * Check if a category belongs to a user directly or via their shared family core
 * @param {number} categoryId 
 * @param {number} userId 
 */
async function isCategoryAccessibleByUser(categoryId, userId) {
  const text = `
    SELECT c.id
    FROM finances.categories c
    WHERE c.id = $1 AND (
      c.user_id = $2
      OR (
        c.family_id IS NOT NULL 
        AND c.family_id = (SELECT family_core FROM finances.users WHERE id = $2)
      )
      OR (
        c.user_id IN (
          SELECT id FROM finances.users 
          WHERE family_core IS NOT NULL 
            AND family_core = (SELECT family_core FROM finances.users WHERE id = $2)
        )
      )
    );
  `;
  const res = await db.query(text, [categoryId, userId]);
  return Boolean(res.rows[0]);
}

/**
 * Find an expense by its ID in finances.outcome with category metadata
 * @param {number} id 
 */
async function findById(id) {
  const text = `
    SELECT 
      o.id,
      o.user_id,
      o.category_id,
      c.name AS category_name,
      COALESCE(o.name, 'Gasto general') AS name,
      o.incomeamount::float AS amount,
      TO_CHAR(o.date, 'YYYY-MM-DD') AS date,
      o.created_at,
      o.updated_at
    FROM finances.outcome o
    LEFT JOIN finances.categories c ON o.category_id = c.id
    WHERE o.id = $1;
  `;
  const res = await db.query(text, [id]);
  return res.rows[0] || null;
}

/**
 * Find all expenses with optional filters (user_id, category_id, start_date, end_date)
 * @param {{ user_id?: number, category_id?: number, start_date?: string, end_date?: string }} filters 
 */
async function findAll(filters = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (filters.user_id !== undefined) {
    conditions.push(`o.user_id = $${paramIndex}`);
    params.push(filters.user_id);
    paramIndex++;
  }

  if (filters.category_id !== undefined) {
    conditions.push(`o.category_id = $${paramIndex}`);
    params.push(filters.category_id);
    paramIndex++;
  }

  if (filters.start_date !== undefined) {
    conditions.push(`o.date >= $${paramIndex}::date`);
    params.push(filters.start_date);
    paramIndex++;
  }

  if (filters.end_date !== undefined) {
    conditions.push(`o.date <= $${paramIndex}::date`);
    params.push(filters.end_date);
    paramIndex++;
  }

  let text = `
    SELECT 
      o.id,
      o.user_id,
      o.category_id,
      c.name AS category_name,
      COALESCE(o.name, 'Gasto general') AS name,
      o.incomeamount::float AS amount,
      TO_CHAR(o.date, 'YYYY-MM-DD') AS date,
      o.created_at,
      o.updated_at
    FROM finances.outcome o
    LEFT JOIN finances.categories c ON o.category_id = c.id
  `;

  if (conditions.length > 0) {
    text += ` WHERE ${conditions.join(' AND ')}`;
  }

  text += ` ORDER BY o.date DESC, o.id DESC LIMIT 200;`;

  const res = await db.query(text, params);
  return res.rows;
}

/**
 * Create a new expense entry in finances.outcome with category_id
 * @param {{ user_id: number, category_id: number, amount: number, date: string, name?: string }} data 
 */
async function create(data) {
  const text = `
    WITH inserted AS (
      INSERT INTO finances.outcome (user_id, category_id, incomeamount, date, name)
      VALUES ($1, $2, $3, $4::date, COALESCE($5, 'Gasto general'))
      RETURNING id, user_id, category_id, incomeamount, date, name, created_at
    )
    SELECT 
      i.id,
      i.user_id,
      i.category_id,
      c.name AS category_name,
      COALESCE(i.name, 'Gasto general') AS name,
      i.incomeamount::float AS amount,
      TO_CHAR(i.date, 'YYYY-MM-DD') AS date,
      i.created_at
    FROM inserted i
    LEFT JOIN finances.categories c ON i.category_id = c.id;
  `;
  const res = await db.query(text, [data.user_id, data.category_id, data.amount, data.date, data.name || null]);
  return res.rows[0];
}

/**
 * Update an existing expense entry in finances.outcome
 * @param {number} id 
 * @param {{ user_id?: number, category_id?: number, amount?: number, date?: string, name?: string }} data 
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
    params.push(data.name);
    paramIndex++;
  }

  if (data.category_id !== undefined) {
    updates.push(`category_id = $${paramIndex}`);
    params.push(data.category_id);
    paramIndex++;
  }

  if (data.amount !== undefined) {
    updates.push(`incomeamount = $${paramIndex}`);
    params.push(data.amount);
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
    WITH updated AS (
      UPDATE finances.outcome
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, user_id, category_id, incomeamount, date, name, created_at, updated_at
    )
    SELECT 
      u.id,
      u.user_id,
      u.category_id,
      c.name AS category_name,
      COALESCE(u.name, 'Gasto general') AS name,
      u.incomeamount::float AS amount,
      TO_CHAR(u.date, 'YYYY-MM-DD') AS date,
      u.created_at,
      u.updated_at
    FROM updated u
    LEFT JOIN finances.categories c ON u.category_id = c.id;
  `;

  const res = await db.query(text, params);
  return res.rows[0] || null;
}

/**
 * Remove an expense entry by ID from finances.outcome
 * @param {number} id 
 */
async function remove(id) {
  const text = `
    DELETE FROM finances.outcome
    WHERE id = $1
    RETURNING id;
  `;
  const res = await db.query(text, [id]);
  return res.rows[0] || null;
}

module.exports = {
  checkUserExists,
  getCategoryById,
  isCategoryAccessibleByUser,
  findById,
  findAll,
  create,
  update,
  remove
};
