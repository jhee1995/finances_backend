const db = require('../../shared/database/db');

/**
 * Format telegram record
 * @param {Object} row 
 */
function mapTelegramRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    chatId: row.chat_id ? Number(row.chat_id) : null,
    token: row.token,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

/**
 * Retrieve telegram linking record by user_id
 * @param {number} userId 
 */
async function getLinkByUserId(userId) {
  const query = `
    SELECT id, user_id, chat_id, token, created_at, updated_at
    FROM finances.telegram
    WHERE user_id = $1;
  `;
  const res = await db.query(query, [userId]);
  return mapTelegramRow(res.rows[0]);
}

/**
 * Retrieve telegram linking record by chat_id
 * @param {number} chatId 
 */
async function getLinkByChatId(chatId) {
  const query = `
    SELECT id, user_id, chat_id, token, created_at, updated_at
    FROM finances.telegram
    WHERE chat_id = $1;
  `;
  const res = await db.query(query, [chatId]);
  return mapTelegramRow(res.rows[0]);
}

/**
 * Save or update generated linking token for a user
 * @param {number} userId 
 * @param {string} token 
 */
async function upsertToken(userId, token) {
  const query = `
    INSERT INTO finances.telegram (user_id, token, updated_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id)
    DO UPDATE SET token = EXCLUDED.token, updated_at = CURRENT_TIMESTAMP
    RETURNING id, user_id, chat_id, token, created_at, updated_at;
  `;
  const res = await db.query(query, [userId, token]);
  return mapTelegramRow(res.rows[0]);
}

/**
 * Link telegram chat_id to a user
 * @param {Object} params - { userId, chatId, token }
 */
async function upsertLink({ userId, chatId, token = null }) {
  const effectiveToken = token || `tg_token_${Date.now()}`;
  const query = `
    INSERT INTO finances.telegram (user_id, chat_id, token, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id)
    DO UPDATE SET 
      chat_id = EXCLUDED.chat_id, 
      token = COALESCE(EXCLUDED.token, finances.telegram.token), 
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, user_id, chat_id, token, created_at, updated_at;
  `;
  const res = await db.query(query, [userId, chatId, effectiveToken]);
  return mapTelegramRow(res.rows[0]);
}

/**
 * Delete telegram link for a user
 * @param {number} userId 
 */
async function deleteLinkByUserId(userId) {
  const query = `
    DELETE FROM finances.telegram
    WHERE user_id = $1
    RETURNING id;
  `;
  const res = await db.query(query, [userId]);
  return res.rowCount > 0;
}

module.exports = {
  getLinkByUserId,
  getLinkByChatId,
  upsertToken,
  upsertLink,
  deleteLinkByUserId
};
