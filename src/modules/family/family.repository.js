const db = require('../../shared/database/db');

/**
 * Create family core and link admin user atomically
 * @param {{ family_name: string, admin_user_id: number }} param0 
 */
async function createFamilyCore({ family_name, admin_user_id }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const insertRes = await client.query(`
      INSERT INTO finances.family_core (family_name, admin_user_id)
      VALUES ($1, $2)
      RETURNING id, family_name, admin_user_id, created_at, updated_at
    `, [family_name, admin_user_id]);

    const family = insertRes.rows[0];

    await client.query(`
      UPDATE finances.users
      SET family_core = $1, updated_at = NOW()
      WHERE id = $2
    `, [family.id, admin_user_id]);

    await client.query('COMMIT');
    return family;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get family core by ID
 * @param {number} id 
 */
async function getFamilyById(id) {
  const res = await db.query(`
    SELECT id, family_name, admin_user_id, created_at, updated_at
    FROM finances.family_core
    WHERE id = $1
  `, [id]);
  return res.rows[0] || null;
}

/**
 * Get all members of a family core with full name and admin flag
 * @param {number} familyId 
 */
async function getFamilyMembers(familyId) {
  const res = await db.query(`
    SELECT 
      u.id,
      TRIM(CONCAT(u.first_name, ' ', COALESCE(u.middle_name, ''), ' ', u.last_name)) as name,
      u.email,
      u.family_core,
      (CASE WHEN u.id = f.admin_user_id THEN true ELSE false END) as is_admin
    FROM finances.users u
    JOIN finances.family_core f ON f.id = u.family_core
    WHERE u.family_core = $1
    ORDER BY is_admin DESC, u.id ASC
  `, [familyId]);
  return res.rows;
}

/**
 * Get user by ID
 * @param {number} userId 
 */
async function getUserById(userId) {
  const res = await db.query(`
    SELECT id, first_name, last_name, email, family_core
    FROM finances.users
    WHERE id = $1
  `, [userId]);
  return res.rows[0] || null;
}

/**
 * Get user by email
 * @param {string} email 
 */
async function getUserByEmail(email) {
  const res = await db.query(`
    SELECT id, first_name, last_name, email, family_core
    FROM finances.users
    WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
  `, [email]);
  return res.rows[0] || null;
}

/**
 * Add member to family core
 * @param {number} familyId 
 * @param {number} userId 
 */
async function addMemberToFamily(familyId, userId) {
  const res = await db.query(`
    UPDATE finances.users
    SET family_core = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING id, email, family_core
  `, [familyId, userId]);
  return res.rows[0] || null;
}

/**
 * Remove member from family core
 * @param {number} familyId 
 * @param {number} userId 
 */
async function removeMemberFromFamily(familyId, userId) {
  const res = await db.query(`
    UPDATE finances.users
    SET family_core = NULL, updated_at = NOW()
    WHERE id = $1 AND family_core = $2
    RETURNING id, email, family_core
  `, [userId, familyId]);
  return res.rows[0] || null;
}

/**
 * Get aggregated financial metrics for a family core
 * @param {number} familyId 
 * @param {number} year 
 */
async function getFamilyFinancialSummary(familyId, year) {
  const membersRes = await db.query(`
    SELECT 
      u.id,
      TRIM(CONCAT(u.first_name, ' ', COALESCE(u.middle_name, ''), ' ', u.last_name)) as name,
      u.email,
      (CASE WHEN u.id = f.admin_user_id THEN true ELSE false END) as is_admin,
      COALESCE((
        SELECT SUM(c.incomeamount)
        FROM finances.cashflow c
        WHERE c.user_id = u.id AND EXTRACT(YEAR FROM c.date) = $2
      ), 0) as income,
      COALESCE((
        SELECT SUM(o.incomeamount)
        FROM finances.outcome o
        WHERE o.user_id = u.id AND EXTRACT(YEAR FROM o.date) = $2
      ), 0) as expenses,
      COALESCE((
        SELECT SUM(d.loan_amount)
        FROM finances.debt d
        WHERE d.user_id = u.id AND d.status = true
      ), 0) as debt_balance
    FROM finances.users u
    JOIN finances.family_core f ON f.id = u.family_core
    WHERE u.family_core = $1
    ORDER BY is_admin DESC, u.id ASC
  `, [familyId, year]);

  // Family-level debts assigned directly to family_id
  const familyDebtRes = await db.query(`
    SELECT COALESCE(SUM(loan_amount), 0) as direct_family_debt
    FROM finances.debt
    WHERE family_id = $1 AND status = true AND user_id IS NULL
  `, [familyId]);

  const directFamilyDebt = parseFloat(familyDebtRes.rows[0]?.direct_family_debt || 0);

  return {
    members: membersRes.rows,
    directFamilyDebt
  };
}

module.exports = {
  createFamilyCore,
  getFamilyById,
  getFamilyMembers,
  getUserById,
  getUserByEmail,
  addMemberToFamily,
  removeMemberFromFamily,
  getFamilyFinancialSummary
};
