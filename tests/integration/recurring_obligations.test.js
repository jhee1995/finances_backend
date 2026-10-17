const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3095;
let testUserId = null;
let foreignUserId = null;
let testCategoryId = null;

function makeToken(userId, email = 'user@example.com') {
  return Buffer.from(`${userId}:${Date.now()}:${email}`).toString('base64');
}

before(async () => {
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  // [TEST DATA FIXTURE] Isolated test user & category
  const userRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('RecTest', 'User', 'rec.test.${Date.now()}@example.com')
    RETURNING id;
  `);
  testUserId = parseInt(userRes.rows[0].id, 10);

  const foreignRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('ForeignRec', 'User', 'foreign.rec.${Date.now()}@example.com')
    RETURNING id;
  `);
  foreignUserId = parseInt(foreignRes.rows[0].id, 10);

  const catRes = await db.query(`
    INSERT INTO finances.categories (name, percentage, user_id)
    VALUES ('Vivienda y Servicios', 30, $1)
    RETURNING id;
  `, [testUserId]);
  testCategoryId = parseInt(catRes.rows[0].id, 10);
});

after(async () => {
  if (testUserId) {
    await db.query(`DELETE FROM finances.recurring_obligation_payments WHERE user_id = $1;`, [testUserId]);
    await db.query(`DELETE FROM finances.recurring_obligations WHERE user_id = $1;`, [testUserId]);
    await db.query(`DELETE FROM finances.outcome WHERE user_id = $1;`, [testUserId]);
    await db.query(`DELETE FROM finances.categories WHERE user_id = $1;`, [testUserId]);
    await db.query(`DELETE FROM finances.users WHERE id = $1;`, [testUserId]);
  }
  if (foreignUserId) {
    await db.query(`DELETE FROM finances.users WHERE id = $1;`, [foreignUserId]);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('US-020 Integration Test Suite: Recurring Obligations Management (No Debt)', () => {
  let createdMonthlyId = null;
  let createdQuincenalId = null;

  test('Scenario 1: Happy Path - POST /api/recurring-obligations creates monthly obligation (201)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Arriendo Apartamento 301',
        amount: 1600000.00,
        frequency: 'MENSUAL',
        due_day: 5,
        category_id: testCategoryId,
        notes: 'Pago antes del día 5'
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    createdMonthlyId = body.id;
    assert.equal(body.name, 'Arriendo Apartamento 301');
    assert.equal(body.amount, 1600000.00);
    assert.equal(body.frequency, 'MENSUAL');
    assert.equal(body.due_day, 5);
    assert.equal(body.status, 'ACTIVE');
    assert.equal(body.category_name, 'Vivienda y Servicios');
  });

  test('Scenario 2: Happy Path - POST /api/recurring-obligations creates quincenal obligation (201)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Mercado Programado Quincenal',
        amount: 450000.00,
        frequency: 'QUINCENAL',
        due_day: 15,
        due_day_secondary: 30,
        category_id: testCategoryId
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    createdQuincenalId = body.id;
    assert.equal(body.frequency, 'QUINCENAL');
    assert.equal(body.due_day, 15);
    assert.equal(body.due_day_secondary, 30);
  });

  test('Scenario 3: Validation Failure - POST /api/recurring-obligations rejects amount <= 0 (422)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Servicio Inválido',
        amount: -50000,
        frequency: 'MENSUAL',
        due_day: 10,
        category_id: testCategoryId
      })
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.status, 422);
    assert.ok(body.invalid_params.some(p => p.name === 'amount'));
  });

  test('Scenario 4: Validation Failure - POST /api/recurring-obligations rejects invalid frequency (422)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Suscripción Semanal',
        amount: 25000,
        frequency: 'SEMANAL',
        due_day: 1,
        category_id: testCategoryId
      })
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.status, 422);
    assert.ok(body.invalid_params.some(p => p.name === 'frequency'));
  });

  test('Scenario 5: Happy Path Listing - GET /api/recurring-obligations returns registered obligations (200)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations?user_id=${testUserId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    assert.equal(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 2);
    assert.ok(list.some(o => o.id === createdMonthlyId));
    assert.ok(list.some(o => o.id === createdQuincenalId));
  });

  test('Scenario 6: Period Status - GET /api/recurring-obligations/period-status calculates committed, covered and pending (200)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations/period-status?user_id=${testUserId}&year=2026&month=10`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.period.year, 2026);
    assert.equal(data.period.month, 10);
    assert.ok(data.summary);
    // 1 monthly (1.600.000) + 2 quincenas of 450.000 (900.000) = 2.500.000
    assert.equal(data.summary.totalCommitted, 2500000.00);
    assert.equal(data.summary.totalCovered, 0);
    assert.equal(data.summary.totalPending, 2500000.00);
    assert.equal(data.summary.coveredCount, 0);
    assert.equal(data.summary.pendingCount, 3);
  });

  test('Scenario 7: Period Status Quincenal Filter - GET /api/recurring-obligations/period-status?cycle=1 (200)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations/period-status?user_id=${testUserId}&year=2026&month=10&cycle=1`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.period.cycle, 1);
    // In cycle 1: monthly (due_day 5 <= 15) = 1.600.000 + quincenal cycle 1 = 450.000 -> 2.050.000
    assert.equal(data.summary.totalCommitted, 2050000.00);
    assert.equal(data.items.length, 2);
  });

  test('Scenario 8: Happy Path Pay - POST /api/recurring-obligations/:id/pay marks paid and creates outcome expense atomically (201)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations/${createdMonthlyId}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        payment_date: '2026-10-05',
        actual_amount: 1600000.00,
        period_year: 2026,
        period_month: 10,
        period_cycle: 1,
        notes: 'Transferencia bancaria exitosa'
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.payment);
    assert.equal(body.payment.obligation_id, createdMonthlyId);
    assert.equal(body.payment.amount, 1600000.00);
    assert.ok(body.expense);
    assert.ok(body.expense.id);
    assert.equal(body.expense.amount, 1600000.00);
    assert.equal(body.obligation.isCovered, true);

    // Verify period status updated
    const statusRes = await fetch(`http://localhost:${PORT}/api/recurring-obligations/period-status?user_id=${testUserId}&year=2026&month=10`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const statusData = await statusRes.json();
    assert.equal(statusData.summary.totalCovered, 1600000.00);
    assert.equal(statusData.summary.totalPending, 900000.00);
    assert.equal(statusData.summary.coveredCount, 1);
  });

  test('Scenario 9: Idempotency Conflict - POST /api/recurring-obligations/:id/pay rejects double pay in same cycle (409)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations/${createdMonthlyId}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        payment_date: '2026-10-05',
        actual_amount: 1600000.00,
        period_year: 2026,
        period_month: 10,
        period_cycle: 1
      })
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.status, 409);
    assert.ok(body.detail.includes('ya se encuentra registrada'));
  });

  test('Scenario 10: Anti-IDOR Protection - Foreign user cannot pay another user obligation (403)', async () => {
    const foreignToken = makeToken(foreignUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations/${createdMonthlyId}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${foreignToken}`
      },
      body: JSON.stringify({
        period_year: 2026,
        period_month: 10,
        period_cycle: 1
      })
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.status, 403);
  });

  test('Scenario 11: Not Found - POST /api/recurring-obligations/999999/pay returns 404', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations/999999/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        period_year: 2026,
        period_month: 10,
        period_cycle: 1
      })
    });

    assert.equal(res.status, 404);
  });

  test('Scenario 12: Delete / Deactivate - DELETE /api/recurring-obligations/:id deactivates obligation (204)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations/${createdQuincenalId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    assert.equal(res.status, 204);

    // Verify it is no longer ACTIVE in list
    const listRes = await fetch(`http://localhost:${PORT}/api/recurring-obligations?user_id=${testUserId}&status=ACTIVE`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const list = await listRes.json();
    assert.ok(!list.some(o => o.id === createdQuincenalId));
  });

  test('Scenario 13: Delete Not Found - DELETE /api/recurring-obligations/999999 returns 404', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations/999999`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    assert.equal(res.status, 404);
  });

  test('Scenario 14: Zero-State - Period status for user without obligations returns 0 totals', async () => {
    const foreignToken = makeToken(foreignUserId);
    const res = await fetch(`http://localhost:${PORT}/api/recurring-obligations/period-status?user_id=${foreignUserId}&year=2026&month=10`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${foreignToken}`
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.summary.totalCommitted, 0);
    assert.equal(body.summary.totalCovered, 0);
    assert.equal(body.summary.totalPending, 0);
    assert.equal(body.items.length, 0);
  });
});
