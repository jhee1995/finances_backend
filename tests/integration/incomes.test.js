const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3093;
let testUserId = null;
let createdIncomeId = null;

before(async () => {
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  // Create isolated test user fixture
  const userRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('IncomeTest', 'User', 'income.test.${Date.now()}@example.com')
    RETURNING id;
  `);
  testUserId = parseInt(userRes.rows[0].id, 10);
});

after(async () => {
  // Clean up any incomes created by this test user
  if (testUserId) {
    await db.query('DELETE FROM finances.cashflow WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [testUserId]);
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
});

describe('US-004 Integration Test Suite: CashFlow Incomes Management', () => {

  test('Scenario 1: Happy Path - POST /api/incomes creates income in Supabase (201 Created)', async () => {
    const payload = {
      user_id: testUserId,
      income_amount: 3500000.50,
      date: '2026-10-14'
    };

    const res = await fetch(`http://localhost:${PORT}/api/incomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201, 'Expected HTTP 201 Created');
    const data = await res.json();

    assert.ok(data.id, 'Response must include assigned ID');
    assert.equal(data.user_id, testUserId);
    assert.equal(data.income_amount, 3500000.50);
    assert.equal(data.date, '2026-10-14');
    assert.ok(data.created_at);

    createdIncomeId = data.id;
  });

  test('Scenario 2: Validation Failure - POST /api/incomes rejects amount <= 0 (422 ProblemDetails)', async () => {
    const invalidPayload = {
      user_id: testUserId,
      income_amount: -500,
      date: '2026-10-14'
    };

    const res = await fetch(`http://localhost:${PORT}/api/incomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 Unprocessable Entity');
    const problem = await res.json();

    assert.equal(problem.status, 422);
    assert.ok(Array.isArray(problem.invalid_params));
    assert.ok(problem.invalid_params.some(p => p.name === 'income_amount'));
  });

  test('Scenario 3: Validation Failure - POST /api/incomes rejects invalid date format (422 ProblemDetails)', async () => {
    const invalidPayload = {
      user_id: testUserId,
      income_amount: 1000,
      date: '14/10/2026' // Non-ISO
    };

    const res = await fetch(`http://localhost:${PORT}/api/incomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 Unprocessable Entity');
    const problem = await res.json();

    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'date'));
  });

  test('Scenario 4: Entity Error - POST /api/incomes rejects non-existent user_id (422 ProblemDetails)', async () => {
    const nonExistentPayload = {
      user_id: 9999999,
      income_amount: 1500,
      date: '2026-10-14'
    };

    const res = await fetch(`http://localhost:${PORT}/api/incomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nonExistentPayload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 for non-existent foreign user');
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.detail.includes('usuario'));
  });

  test('Scenario 5: Happy Path Listing - GET /api/incomes lists registered incomes (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/incomes`);
    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const data = await res.json();

    assert.ok(Array.isArray(data), 'Response must be an array');
    assert.ok(data.some(inc => inc.id === createdIncomeId), 'Created income must be in the list');
  });

  test('Scenario 6: Filter by User - GET /api/incomes?user_id=X returns user-specific incomes (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/incomes?user_id=${testUserId}`);
    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const data = await res.json();

    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 1);
    assert.ok(data.every(inc => inc.user_id === testUserId));
  });

  test('Scenario 7: Happy Path Get by ID - GET /api/incomes/:id returns single income (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/incomes/${createdIncomeId}`);
    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const data = await res.json();

    assert.equal(data.id, createdIncomeId);
    assert.equal(data.user_id, testUserId);
    assert.equal(data.income_amount, 3500000.50);
  });

  test('Scenario 8: Not Found - GET /api/incomes/:id with non-existent ID (404 Not Found)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/incomes/9999999`);
    assert.equal(res.status, 404, 'Expected HTTP 404 Not Found');
    const problem = await res.json();
    assert.equal(problem.status, 404);
  });

  test('Scenario 9: Happy Path Update - PUT /api/incomes/:id updates amount and date (200 OK)', async () => {
    const updatePayload = {
      income_amount: 4200000.00,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/incomes/${createdIncomeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });

    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const updated = await res.json();

    assert.equal(updated.id, createdIncomeId);
    assert.equal(updated.income_amount, 4200000.00);
    assert.equal(updated.date, '2026-10-15');
    assert.ok(updated.updated_at);
  });

  test('Scenario 10: Update Errors - PUT /api/incomes/:id edge cases (404, 422)', async () => {
    // 404 on non-existent
    const res404 = await fetch(`http://localhost:${PORT}/api/incomes/9999999`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ income_amount: 100 })
    });
    assert.equal(res404.status, 404);

    // 422 on empty body
    const res422 = await fetch(`http://localhost:${PORT}/api/incomes/${createdIncomeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(res422.status, 422);
  });

  test('Scenario 11: Delete Income - DELETE /api/incomes/:id removes record (204 No Content)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/incomes/${createdIncomeId}`, {
      method: 'DELETE'
    });

    assert.equal(res.status, 204, 'Expected HTTP 204 No Content');

    // Confirm it no longer exists
    const checkRes = await fetch(`http://localhost:${PORT}/api/incomes/${createdIncomeId}`);
    assert.equal(checkRes.status, 404, 'Expected deleted record to return 404');
  });

  test('Scenario 12: Delete Errors - DELETE /api/incomes/:id on non-existent ID (404 Not Found)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/incomes/9999999`, {
      method: 'DELETE'
    });
    assert.equal(res.status, 404, 'Expected HTTP 404 Not Found');
  });

  test('Scenario 13: US-018 Happy Path - POST /api/incomes creates income with descriptive name', async () => {
    const payload = {
      user_id: testUserId,
      name: 'Salario Empresa Tech',
      income_amount: 5200000,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/incomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, 'Salario Empresa Tech');
  });

  test('Scenario 14: US-018 Default Fallback - POST /api/incomes without name defaults to Ingreso registrado', async () => {
    const payload = {
      user_id: testUserId,
      income_amount: 150000,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/incomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, 'Ingreso registrado');
  });

  test('Scenario 15: US-018 Validation Failure - POST /api/incomes rejects empty name or length > 100', async () => {
    const emptyPayload = {
      user_id: testUserId,
      name: '   ',
      income_amount: 200000,
      date: '2026-10-15'
    };

    const resEmpty = await fetch(`http://localhost:${PORT}/api/incomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emptyPayload)
    });

    assert.equal(resEmpty.status, 422);

    const longPayload = {
      user_id: testUserId,
      name: 'A'.repeat(101),
      income_amount: 200000,
      date: '2026-10-15'
    };

    const resLong = await fetch(`http://localhost:${PORT}/api/incomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(longPayload)
    });

    assert.equal(resLong.status, 422);
  });

  test('Scenario 16: US-018 Happy Path Update - PUT /api/incomes/:id updates name', async () => {
    const createRes = await fetch(`http://localhost:${PORT}/api/incomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        name: 'Bono Inicial',
        income_amount: 800000,
        date: '2026-10-15'
      })
    });
    const created = await createRes.json();

    const updateRes = await fetch(`http://localhost:${PORT}/api/incomes/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bono Trimestral Desempeño'
      })
    });

    assert.equal(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.equal(updated.name, 'Bono Trimestral Desempeño');
  });

});
