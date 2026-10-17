const db = require('../../shared/database/db');
const { config } = require('../../config/env');

let lastCheckTime = 0;
let cachedResult = null;
const CACHE_TTL_MS = 2000;

function resetCache() {
  lastCheckTime = 0;
  cachedResult = null;
}

/**
 * Health check controller conforming to contract SYS-001
 * GET /api/health
 */
async function getHealth(req, res) {
  const now = Date.now();
  const isTest = config.NODE_ENV === 'test' || req.query.fresh === 'true';

  // Serve from cache during bursts unless explicitly bypassed or in test suite
  if (!isTest && cachedResult && (now - lastCheckTime < CACHE_TTL_MS)) {
    if (cachedResult.connected) {
      return res.status(200).json({
        status: 'ok',
        service: 'finances-backend',
        database: 'connected',
        environment: config.NODE_ENV,
        timestamp: new Date().toISOString()
      });
    }
  }

  const dbHealth = await db.checkDatabaseConnection();
  lastCheckTime = now;
  cachedResult = dbHealth;

  if (dbHealth.connected) {
    return res.status(200).json({
      status: 'ok',
      service: 'finances-backend',
      database: 'connected',
      environment: config.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  }

  return res.status(503).json({
    status: 'degraded',
    service: 'finances-backend',
    database: 'disconnected',
    error: dbHealth.error || 'Database probe failed',
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  getHealth,
  resetCache
};
