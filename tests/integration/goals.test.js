const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3095;
let testUserId = null;
let foreignUserId = null;
let testDebtId = null;
let createdGoalId = null;

function makeToken(userId, email = 'user@example.com') {
  return Buffer.from(`${userId}:${Date.now()}:${email}`).toString('base64');
}

before(async () => {
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  // [TEST DATA FIXTURE] Isolated test user
  const userRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('GoalTest', 'User', 'goal.test.${Date.now()}@example.com')
    RETURNING id;
  `);
  testUserId = parseInt(userRes.rows[0].id, 10);

  // [TEST DATA FIXTURE] Foreign user
  const foreignUserRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('ForeignGoal', 'User', 'foreign.goal.${Date.now()}@example.com')
    RETURNING id;
  `);
  foreignUserId = parseInt(foreignUserRes.rows[0].id, 10);

  // [TEST DATA FIXTURE] Category and Debt for testUserId
  const catRes = await db.query(`
    INSERT INTO finances.categories (name, percentage, user_id)
    VALUES ('Metas y Obligaciones', 15, $1)
    RETURNING id;
  `, [testUserId]);
  const catId = parseInt(catRes.rows[0].id, 10);

  const debtRes = await db.query(`
    INSERT INTO finances.debt (user_id, category_id, loan_amount, interest_rate, numberofinstallments, installmentsleft, begin_date, status)
    VALUES ($1, $2, 6000000.00, 22.5, 36, 18, '2026-05-01', true)
    RETURNING id;
  `, [testUserId, catId]);
  testDebtId = parseInt(debtRes.rows[0].id, 10);
});

after(async () => {
  if (testUserId) {
    await db.query('DELETE FROM finances.goals WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.debt WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.categories WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [testUserId]);
  }
  if (foreignUserId) {
    await db.query('DELETE FROM finances.users WHERE id = $1;', [foreignUserId]);
  }
  await new Promise((resolve) => server.close(resolve));
});

describe('US-007 Financial Goals API Integration Tests', () => {

  test('GOL-001: POST /api/goals creates savings goal successfully (201)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        goalName: 'Fondo de Emergencia',
        amount: 5000000,
        currentAmount: 1250000,
        targetDate: '2027-12-31',
        isDebt: false
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    createdGoalId = body.id;
    assert.equal(body.goalName, 'Fondo de Emergencia');
    assert.equal(body.amount, 5000000);
    assert.equal(body.currentAmount, 1250000);
    assert.equal(body.progressPercent, 25);
    assert.equal(body.remainingAmount, 3750000);
    assert.equal(body.isDebt, false);
    assert.equal(body.debtId, null);
  });

  test('GOL-001: POST /api/goals creates debt-linked goal successfully (201)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        goalName: 'Liquidar Crédito Libre Inversión',
        amount: 6000000,
        currentAmount: 500000,
        isDebt: true,
        debtId: testDebtId
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.equal(body.isDebt, true);
    assert.equal(body.debtId, testDebtId);
    assert.ok(body.linkedDebt);
    assert.equal(body.linkedDebt.id, testDebtId);
    assert.equal(body.linkedDebt.amortizedPercent, 50); // 18 / 36 = 50%
  });

  test('GOL-001: POST /api/goals rejects empty goalName with 422', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        goalName: '   ',
        amount: 1000000
      })
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'goalName'));
  });

  test('GOL-001: POST /api/goals rejects negative or zero amount with 422', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        goalName: 'Auto Nuevo',
        amount: -5000
      })
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'amount'));
  });

  test('GOL-001: POST /api/goals rejects isDebt: true without debtId with 422', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        goalName: 'Pagar Deuda Sin ID',
        amount: 2000000,
        isDebt: true
      })
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'debtId'));
  });

  test('GOL-001: POST /api/goals rejects isDebt: true with non-existent or foreign debtId with 422', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(foreignUserId)}`
      },
      body: JSON.stringify({
        goalName: 'Intento de robo de deuda ajena',
        amount: 6000000,
        isDebt: true,
        debtId: testDebtId
      })
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'debtId'));
  });

  test('GOL-002: GET /api/goals returns user goals and KPI aggregations (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/goals?userId=${testUserId}`, {
      headers: {
        'Authorization': `Bearer ${makeToken(testUserId)}`
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.goals));
    assert.ok(body.goals.length >= 2);
    assert.ok(body.totalTargetAmount >= 11000000);
    assert.ok(body.totalCurrentAmount >= 1750000);
    assert.ok(body.globalProgressPercent > 0);
  });

  test('GOL-003: GET /api/goals/:id returns goal detail (200)', async () => {
    assert.ok(createdGoalId);
    const res = await fetch(`http://localhost:${PORT}/api/goals/${createdGoalId}`, {
      headers: {
        'Authorization': `Bearer ${makeToken(testUserId)}`
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, createdGoalId);
    assert.equal(body.goalName, 'Fondo de Emergencia');
  });

  test('GOL-003: GET /api/goals/:id returns 404 for non-existent goal', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/goals/999999`, {
      headers: {
        'Authorization': `Bearer ${makeToken(testUserId)}`
      }
    });

    assert.equal(res.status, 404);
  });

  test('GOL-004: PUT /api/goals/:id updates amount and currentAmount (200)', async () => {
    assert.ok(createdGoalId);
    const res = await fetch(`http://localhost:${PORT}/api/goals/${createdGoalId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        currentAmount: 2500000
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.currentAmount, 2500000);
    assert.equal(body.progressPercent, 50); // 2,500,000 / 5,000,000 = 50%
    assert.equal(body.remainingAmount, 2500000);
  });

  test('GOL-004: PUT /api/goals/:id returns 404 for non-existent goal', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/goals/999999`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        currentAmount: 1000
      })
    });

    assert.equal(res.status, 404);
  });

  test('GOL-005: DELETE /api/goals/:id deletes goal successfully (204)', async () => {
    assert.ok(createdGoalId);
    const res = await fetch(`http://localhost:${PORT}/api/goals/${createdGoalId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${makeToken(testUserId)}`
      }
    });

    assert.equal(res.status, 204);

    // Verify deletion
    const verifyRes = await fetch(`http://localhost:${PORT}/api/goals/${createdGoalId}`);
    assert.equal(verifyRes.status, 404);
  });

  test('GOL-005: DELETE /api/goals/:id returns 404 for non-existent goal', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/goals/999999`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${makeToken(testUserId)}`
      }
    });

    assert.equal(res.status, 404);
  });

});
