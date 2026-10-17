const db = require('../../shared/database/db');

/**
 * Find category by name (case-insensitive) in finances.categories, optionally scoped to a user
 * @param {string} name
 * @param {number|null} userId
 */
async function findByName(name, userId = null) {
  let text = `
    SELECT id, name, percentage, user_id, family_id
    FROM finances.categories
    WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
  `;
  const params = [name];

  if (userId) {
    text += ` AND (
      user_id = $2
      OR (
        family_id IS NOT NULL 
        AND family_id = (SELECT family_core FROM finances.users WHERE id = $2)
      )
      OR (
        user_id IN (
          SELECT id FROM finances.users 
          WHERE family_core IS NOT NULL 
            AND family_core = (SELECT family_core FROM finances.users WHERE id = $2)
        )
      )
    )`;
    params.push(userId);
  }

  const res = await db.query(text, params);
  return res.rows[0] || null;
}

/**
 * Find category by ID in finances.categories
 * @param {number} id
 */
async function findById(id) {
  const text = `
    SELECT id, name, percentage, user_id, family_id
    FROM finances.categories
    WHERE id = $1;
  `;
  const res = await db.query(text, [id]);
  return res.rows[0] || null;
}

/**
 * List all categories, optionally filtered by user_id with transversal family scope
 * @param {number|null} userId
 */
async function findAll(userId = null) {
  let text = `
    SELECT id, name, percentage, user_id, family_id
    FROM finances.categories
  `;
  const params = [];

  if (userId) {
    text += `
      WHERE (
        user_id = $1
        OR (
          family_id IS NOT NULL 
          AND family_id = (SELECT family_core FROM finances.users WHERE id = $1)
        )
        OR (
          user_id IN (
            SELECT id FROM finances.users 
            WHERE family_core IS NOT NULL 
              AND family_core = (SELECT family_core FROM finances.users WHERE id = $1)
          )
        )
      )
    `;
    params.push(userId);
  }

  text += ` ORDER BY id ASC;`;
  const res = await db.query(text, params);
  return res.rows;
}

/**
 * Create category in finances.categories with user_id and optional family_id
 * @param {{ name: string, percentage: number, user_id?: number, family_id?: number|null }} data
 */
async function create(data) {
  const fields = ['name', 'percentage'];
  const values = ['$1', '$2'];
  const params = [data.name.trim(), data.percentage];

  if (data.user_id !== undefined && data.user_id !== null) {
    params.push(data.user_id);
    fields.push('user_id');
    values.push(`$${params.length}`);
  }

  if (data.family_id !== undefined && data.family_id !== null) {
    params.push(data.family_id);
    fields.push('family_id');
    values.push(`$${params.length}`);
  }

  const text = `
    INSERT INTO finances.categories (${fields.join(', ')})
    VALUES (${values.join(', ')})
    RETURNING id, name, percentage, user_id, family_id;
  `;
  const res = await db.query(text, params);
  return res.rows[0];
}

/**
 * Update category in finances.categories
 * @param {number} id
 * @param {{ name?: string, percentage?: number, family_id?: number|null }} data
 */
async function update(id, data) {
  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    params.push(data.name.trim());
    paramIndex++;
  }

  if (data.percentage !== undefined) {
    updates.push(`percentage = $${paramIndex}`);
    params.push(data.percentage);
    paramIndex++;
  }

  if (data.family_id !== undefined) {
    updates.push(`family_id = $${paramIndex}`);
    params.push(data.family_id);
    paramIndex++;
  }

  params.push(id);
  const text = `
    UPDATE finances.categories
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, name, percentage, user_id, family_id;
  `;

  const res = await db.query(text, params);
  return res.rows[0] || null;
}

/**
 * Remove category from finances.categories
 * @param {number} id
 */
async function remove(id) {
  const text = `
    DELETE FROM finances.categories
    WHERE id = $1
    RETURNING id;
  `;
  const res = await db.query(text, [id]);
  return res.rows[0] || null;
}

module.exports = {
  findByName,
  findById,
  findAll,
  create,
  update,
  remove
};
