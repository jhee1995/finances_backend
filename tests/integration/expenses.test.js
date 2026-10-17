const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3094;
let testUserId = null;
let testCategoryId = null;
let altCategoryId = null;
let otherUserId = null;
let foreignCategoryId = null;
let createdExpenseId = null;

before(async () => {
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  // [TEST DATA FIXTURE] Isolated test user & categories
  const userRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('ExpenseTest', 'User', 'expense.test.${Date.now()}@example.com')
    RETURNING id;
  `);
  testUserId = parseInt(userRes.rows[0].id, 10);

  const catRes = await db.query(`
    INSERT INTO finances.categories (name, percentage, user_id)
    VALUES ('Alimentación', 30, $1)
    RETURNING id;
  `, [testUserId]);
  testCategoryId = parseInt(catRes.rows[0].id, 10);

  const altCatRes = await db.query(`
    INSERT INTO finances.categories (name, percentage, user_id)
    VALUES ('Transporte', 20, $1)
    RETURNING id;
  `, [testUserId]);
  altCategoryId = parseInt(altCatRes.rows[0].id, 10);

  // [TEST DATA FIXTURE] Foreign user & foreign category (for cross-tenant checks)
  const otherRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('ForeignExpense', 'User', 'foreign.expense.${Date.now()}@example.com')
    RETURNING id;
  `);
  otherUserId = parseInt(otherRes.rows[0].id, 10);

  const foreignCatRes = await db.query(`
    INSERT INTO finances.categories (name, percentage, user_id)
    VALUES ('Categoría Ajena', 40, $1)
    RETURNING id;
  `, [otherUserId]);
  foreignCategoryId = parseInt(foreignCatRes.rows[0].id, 10);
});

after(async () => {
  // Clean up fixtures
  if (testUserId) {
    await db.query('DELETE FROM finances.outcome WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.categories WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [testUserId]);
  }

  if (otherUserId) {
    await db.query('DELETE FROM finances.outcome WHERE user_id = $1;', [otherUserId]);
    await db.query('DELETE FROM finances.categories WHERE user_id = $1;', [otherUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [otherUserId]);
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
});

describe('US-017 / US-005 Integration Test Suite: Outcome Expenses Management with Categorization', () => {

  test('Scenario 1: Happy Path - POST /api/expenses creates categorized expense (201 Created)', async () => {
    const payload = {
      user_id: testUserId,
      category_id: testCategoryId,
      amount: 150000.50,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201, 'Expected HTTP 201 Created');
    const data = await res.json();

    assert.ok(data.id, 'Response must include assigned ID');
    assert.equal(data.user_id, testUserId);
    assert.equal(data.category_id, testCategoryId);
    assert.equal(data.category_name, 'Alimentación');
    assert.equal(data.amount, 150000.50);
    assert.equal(data.date, '2026-10-15');
    assert.ok(data.created_at);

    createdExpenseId = data.id;
  });

  test('Scenario 2: Normalization - POST /api/expenses accepts alternative fields expense_amount and categoryId', async () => {
    const payload = {
      user_id: testUserId,
      categoryId: testCategoryId,
      expense_amount: 85000.00,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201, 'Expected HTTP 201 Created');
    const data = await res.json();
    assert.equal(data.amount, 85000.00);
    assert.equal(data.category_id, testCategoryId);
    assert.equal(data.category_name, 'Alimentación');
  });

  test('Scenario 3: Validation Failure - POST /api/expenses rejects missing category_id (422 ProblemDetails)', async () => {
    const payload = {
      user_id: testUserId,
      amount: 50000.00,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 ProblemDetails');
    const data = await res.json();
    assert.ok(data.invalid_params.some(p => p.name === 'category_id'));
  });

  test('Scenario 4: Integrity Failure - POST /api/expenses rejects non-existent category_id (422 ProblemDetails)', async () => {
    const payload = {
      user_id: testUserId,
      category_id: 999999,
      amount: 50000.00,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 ProblemDetails');
    const data = await res.json();
    assert.equal(data.detail, 'La categoría especificada no existe');
  });

  test('Scenario 5: Cross-Tenant Protection - POST /api/expenses rejects category_id belonging to another user (422 ProblemDetails)', async () => {
    const payload = {
      user_id: testUserId,
      category_id: foreignCategoryId,
      amount: 50000.00,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 ProblemDetails');
    const data = await res.json();
    assert.equal(data.detail, 'La categoría especificada no pertenece al usuario');
  });

  test('Scenario 6: Validation Failure - POST /api/expenses rejects amount <= 0 (422 ProblemDetails)', async () => {
    const invalidPayload = {
      user_id: testUserId,
      category_id: testCategoryId,
      amount: -500,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 Unprocessable Entity');
    assert.equal(res.headers.get('content-type'), 'application/problem+json; charset=utf-8');
    const data = await res.json();
    assert.ok(data.invalid_params.some(p => p.name === 'amount'));
  });

  test('Scenario 7: Validation Failure - POST /api/expenses rejects invalid date format (422 ProblemDetails)', async () => {
    const invalidPayload = {
      user_id: testUserId,
      category_id: testCategoryId,
      amount: 10000,
      date: 'invalid-date'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload)
    });

    assert.equal(res.status, 422);
    const data = await res.json();
    assert.ok(data.invalid_params.some(p => p.name === 'date'));
  });

  test('Scenario 8: Integrity Validation - POST /api/expenses rejects non-existent user_id (422 ProblemDetails)', async () => {
    const invalidPayload = {
      user_id: 9999999,
      category_id: testCategoryId,
      amount: 50000,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload)
    });

    assert.equal(res.status, 422);
    const data = await res.json();
    assert.equal(data.detail, 'El usuario especificado no existe');
  });

  test('Scenario 9: Happy Path - GET /api/expenses filters by user_id and category_id (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/expenses?user_id=${testUserId}&category_id=${testCategoryId}`);
    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const data = await res.json();

    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 1);
    const item = data[0];
    assert.equal(item.user_id, testUserId);
    assert.equal(item.category_id, testCategoryId);
    assert.equal(item.category_name, 'Alimentación');
  });

  test('Scenario 10: Happy Path - GET /api/expenses/:id returns single expense with category metadata (200 OK)', async () => {
    assert.ok(createdExpenseId, 'Fixture must exist');
    const res = await fetch(`http://localhost:${PORT}/api/expenses/${createdExpenseId}`);
    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const data = await res.json();

    assert.equal(data.id, createdExpenseId);
    assert.equal(data.user_id, testUserId);
    assert.equal(data.category_id, testCategoryId);
    assert.equal(data.category_name, 'Alimentación');
    assert.equal(data.amount, 150000.50);
  });

  test('Scenario 11: Not Found - GET /api/expenses/:id with non-existent ID (404 ProblemDetails)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/expenses/9999999`);
    assert.equal(res.status, 404, 'Expected HTTP 404 Not Found');
    const data = await res.json();
    assert.equal(data.status, 404);
  });

  test('Scenario 12: Happy Path - PUT /api/expenses/:id updates amount, date and category_id (200 OK)', async () => {
    assert.ok(createdExpenseId, 'Fixture must exist');
    const updatePayload = {
      amount: 175000.00,
      category_id: altCategoryId,
      date: '2026-10-16'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses/${createdExpenseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });

    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const data = await res.json();

    assert.equal(data.id, createdExpenseId);
    assert.equal(data.amount, 175000.00);
    assert.equal(data.category_id, altCategoryId);
    assert.equal(data.category_name, 'Transporte');
    assert.equal(data.date, '2026-10-16');
  });

  test('Scenario 13: Validation Failure - PUT /api/expenses/:id rejects category_id belonging to another user (422 ProblemDetails)', async () => {
    assert.ok(createdExpenseId, 'Fixture must exist');
    const res = await fetch(`http://localhost:${PORT}/api/expenses/${createdExpenseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: foreignCategoryId })
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 ProblemDetails');
    const data = await res.json();
    assert.equal(data.detail, 'La categoría especificada no pertenece al usuario');
  });

  test('Scenario 14: Validation Failure - PUT /api/expenses/:id rejects empty body (422 ProblemDetails)', async () => {
    assert.ok(createdExpenseId, 'Fixture must exist');
    const res = await fetch(`http://localhost:${PORT}/api/expenses/${createdExpenseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 ProblemDetails');
  });

  test('Scenario 15: Happy Path - DELETE /api/expenses/:id deletes expense (204 No Content)', async () => {
    assert.ok(createdExpenseId, 'Fixture must exist');
    const res = await fetch(`http://localhost:${PORT}/api/expenses/${createdExpenseId}`, {
      method: 'DELETE'
    });

    assert.equal(res.status, 204, 'Expected HTTP 204 No Content');

    // Confirm deletion
    const getRes = await fetch(`http://localhost:${PORT}/api/expenses/${createdExpenseId}`);
    assert.equal(getRes.status, 404, 'Expected HTTP 404 after deletion');
  });

  test('Scenario 16: Not Found - DELETE /api/expenses/:id with non-existent ID (404 ProblemDetails)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/expenses/9999999`, {
      method: 'DELETE'
    });
    assert.equal(res.status, 404);
  });

  test('Scenario 17: US-018 Happy Path - POST /api/expenses creates expense with descriptive name', async () => {
    const payload = {
      user_id: testUserId,
      category_id: testCategoryId,
      name: 'Mercado Mensual Supermercado',
      amount: 450000,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, 'Mercado Mensual Supermercado');
  });

  test('Scenario 18: US-018 Default Fallback - POST /api/expenses without name defaults to Gasto general', async () => {
    const payload = {
      user_id: testUserId,
      category_id: testCategoryId,
      amount: 15000,
      date: '2026-10-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, 'Gasto general');
  });

  test('Scenario 19: US-018 Validation Failure - POST /api/expenses rejects empty name or length > 100', async () => {
    const emptyPayload = {
      user_id: testUserId,
      category_id: testCategoryId,
      name: '   ',
      amount: 25000,
      date: '2026-10-15'
    };

    const resEmpty = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emptyPayload)
    });

    assert.equal(resEmpty.status, 422);

    const longPayload = {
      user_id: testUserId,
      category_id: testCategoryId,
      name: 'E'.repeat(101),
      amount: 25000,
      date: '2026-10-15'
    };

    const resLong = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(longPayload)
    });

    assert.equal(resLong.status, 422);
  });

  test('Scenario 20: US-018 Happy Path Update - PUT /api/expenses/:id updates name', async () => {
    const createRes = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        category_id: testCategoryId,
        name: 'Farmacia Inicial',
        amount: 32000,
        date: '2026-10-15'
      })
    });
    const created = await createRes.json();

    const updateRes = await fetch(`http://localhost:${PORT}/api/expenses/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Medicamentos Especializados'
      })
    });

    assert.equal(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.equal(updated.name, 'Medicamentos Especializados');
  });

});
