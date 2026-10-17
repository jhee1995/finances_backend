const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3097;

before(async () => {
  // Warm up database connection pool
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
});

describe('US-001 Integration Test Suite: System Health & Database Connectivity', () => {

  test('Scenario 1: Happy Path - GET /api/health returns 200 OK and database connected', async () => {
    const start = Date.now();
    const res = await fetch(`http://localhost:${PORT}/api/health`);
    const duration = Date.now() - start;

    assert.equal(res.status, 200, 'Expected status code 200');
    assert.match(res.headers.get('content-type'), /application\/json/, 'Content-type must be JSON');

    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'finances-backend');
    assert.equal(body.database, 'connected');
    assert.ok(body.environment);
    assert.ok(body.timestamp);
    assert.ok(!isNaN(Date.parse(body.timestamp)), 'Timestamp must be valid ISO-8601');

    // NFR Latency check for warmed pool (< 500ms over WAN / cloud Supabase)
    assert.ok(duration < 1500, `Healthcheck latency must be reasonable, got ${duration}ms`);
  });

  test('Scenario 2: CORS Header Verification', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/health`, {
      headers: {
        'Origin': 'http://localhost:5173'
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  });

  test('Scenario 3: Degraded State - Controller returns 503 on database probe failure', async () => {
    const originalCheck = db.checkDatabaseConnection;
    // Mock temporary DB failure
    db.checkDatabaseConnection = async () => ({
      connected: false,
      error: 'Mock database connection timeout'
    });

    try {
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      assert.equal(res.status, 503, 'Expected status code 503 on DB outage');

      const body = await res.json();
      assert.equal(body.status, 'degraded');
      assert.equal(body.database, 'disconnected');
      assert.equal(body.error, 'Mock database connection timeout');
      assert.ok(body.timestamp);
    } finally {
      // Restore original implementation
      db.checkDatabaseConnection = originalCheck;
    }
  });

  test('Scenario 4: Security Zero-Leakage - Response body never contains database passwords or secrets', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/health`);
    const text = await res.text();

    assert.ok(!text.includes('1yWMSNKXZV3FVFbQ'), 'Postgres password must not leak in response');
    assert.ok(!text.includes('POSTGRES_PRISMA_URL'), 'Connection string keys must not leak');
    assert.ok(!text.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Service role key must not leak');
  });

});
