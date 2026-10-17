const { Pool } = require('pg');
const { config } = require('../../config/env');

const pool = new Pool({
  host: config.POSTGRES_HOST,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  database: config.POSTGRES_DATABASE,
  port: config.POSTGRES_PORT,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

/**
 * Health probe for Supabase PostgreSQL connection
 * @returns {Promise<{ connected: boolean, latencyMs?: number, error?: string }>}
 */
async function checkDatabaseConnection() {
  const start = Date.now();
  try {
    const res = await pool.query('SELECT 1 AS health;');
    const latencyMs = Date.now() - start;
    if (res.rows && res.rows[0]?.health === 1) {
      return { connected: true, latencyMs };
    }
    return { connected: false, error: 'Unexpected response from database' };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

/**
 * Helper to execute parameterized queries
 * @param {string} text 
 * @param {any[]} params 
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Close database pool
 */
function close() {
  return pool.end();
}

module.exports = {
  pool,
  query,
  checkDatabaseConnection,
  close
};
