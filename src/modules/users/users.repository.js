const db = require('../../shared/database/db');

/**
 * Find user by email in finances.users
 * @param {string} email 
 */
async function findByEmail(email) {
  const text = `
    SELECT id, first_name, middle_name, last_name, email, family_core, created_at, updated_at
    FROM finances.users
    WHERE email = $1;
  `;
  const res = await db.query(text, [email.toLowerCase().trim()]);
  return res.rows[0] || null;
}

/**
 * Find user by ID in finances.users
 * @param {number} id 
 */
async function findById(id) {
  const text = `
    SELECT id, first_name, middle_name, last_name, email, family_core, created_at, updated_at
    FROM finances.users
    WHERE id = $1;
  `;
  const res = await db.query(text, [id]);
  return res.rows[0] || null;
}

/**
 * List users with optional email filter
 * @param {{ email?: string }} filters 
 */
async function findAll(filters = {}) {
  let text = `
    SELECT id, first_name, middle_name, last_name, email, family_core, created_at, updated_at
    FROM finances.users
  `;
  const params = [];

  if (filters.email) {
    text += ` WHERE email = $1`;
    params.push(filters.email.toLowerCase().trim());
  }

  text += ` ORDER BY id ASC LIMIT 100;`;
  const res = await db.query(text, params);
  return res.rows;
}

/**
 * Find user by email including pass for authentication verification only
 * @param {string} email 
 */
async function findByEmailWithPassword(email) {
  const text = `
    SELECT id, first_name, middle_name, last_name, email, pass, family_core, created_at, updated_at
    FROM finances.users
    WHERE email = $1;
  `;
  const res = await db.query(text, [email.toLowerCase().trim()]);
  return res.rows[0] || null;
}

/**
 * Create user profile in finances.users
 * @param {{ first_name: string, middle_name?: string|null, last_name: string, email: string, family_core?: number|null, pass?: string }} data 
 */
async function create(data) {
  let text;
  let params;

  if (data.pass) {
    text = `
      INSERT INTO finances.users (first_name, middle_name, last_name, email, family_core, pass)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, first_name, middle_name, last_name, email, family_core, created_at;
    `;
    params = [
      data.first_name.trim(),
      data.middle_name ? data.middle_name.trim() : null,
      data.last_name.trim(),
      data.email.toLowerCase().trim(),
      data.family_core || null,
      data.pass
    ];
  } else {
    text = `
      INSERT INTO finances.users (first_name, middle_name, last_name, email, family_core)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, first_name, middle_name, last_name, email, family_core, created_at;
    `;
    params = [
      data.first_name.trim(),
      data.middle_name ? data.middle_name.trim() : null,
      data.last_name.trim(),
      data.email.toLowerCase().trim(),
      data.family_core || null
    ];
  }

  const res = await db.query(text, params);
  return res.rows[0];
}

/**
 * Update user profile by ID
 * @param {number} id 
 * @param {{ first_name: string, middle_name?: string|null, last_name: string }} data 
 */
async function update(id, data) {
  const text = `
    UPDATE finances.users
    SET first_name = $1,
        middle_name = $2,
        last_name = $3,
        updated_at = NOW()
    WHERE id = $4
    RETURNING id, first_name, middle_name, last_name, email, family_core, created_at, updated_at;
  `;
  const params = [
    data.first_name.trim(),
    data.middle_name ? data.middle_name.trim() : null,
    data.last_name.trim(),
    id
  ];
  const res = await db.query(text, params);
  return res.rows[0] || null;
}

module.exports = {
  findByEmail,
  findByEmailWithPassword,
  findById,
  findAll,
  create,
  update
};
