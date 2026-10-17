const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');
const paymentPlansService = require('../../src/modules/payment_plans/payment_plans.service');

let server;
const PORT = 3094;
let testUserId = null;
let testCategoryId = null;
let foreignUserId = null;
let debtHighRateId = null;
let debtLowBalanceId = null;

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
    VALUES ('PlanTest', 'User', 'plan.test.${Date.now()}@example.com')
    RETURNING id;
  `);
  testUserId = parseInt(userRes.rows[0].id, 10);

  const catRes = await db.query(`
    INSERT INTO finances.categories (name, percentage, user_id)
    VALUES ('Tarjetas y Créditos', 20, $1)
    RETURNING id;
  `, [testUserId]);
  testCategoryId = parseInt(catRes.rows[0].id, 10);

  // [TEST DATA FIXTURE] Foreign user for anti-IDOR tests
  const foreignUserRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('ForeignPlan', 'User', 'foreign.plan.${Date.now()}@example.com')
    RETURNING id;
  `);
  foreignUserId = parseInt(foreignUserRes.rows[0].id, 10);

  // [TEST DATA FIXTURE] 2 active debts for testUserId
  // Debt 1: High rate (32.0% EA), high balance ($2,000,000), 24 installments
  const d1Res = await db.query(`
    INSERT INTO finances.debt (user_id, category_id, name, loan_amount, interest_rate, numberofinstallments, installmentsleft, begin_date, status)
    VALUES ($1, $2, 'Tarjeta Visa Black', 2000000.00, 32.0, 24, 24, '2026-11-01', true)
    RETURNING id;
  `, [testUserId, testCategoryId]);
  debtHighRateId = parseInt(d1Res.rows[0].id, 10);

  // Debt 2: Low rate (14.0% EA), low balance ($500,000), 12 installments
  const d2Res = await db.query(`
    INSERT INTO finances.debt (user_id, category_id, name, loan_amount, interest_rate, numberofinstallments, installmentsleft, begin_date, status)
    VALUES ($1, $2, 'Crédito Vehicular', 500000.00, 14.0, 12, 12, '2026-11-01', true)
    RETURNING id;
  `, [testUserId, testCategoryId]);
  debtLowBalanceId = parseInt(d2Res.rows[0].id, 10);
});

after(async () => {
  if (testUserId) {
    await db.query('DELETE FROM finances.payment_plan WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.debt WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.categories WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [testUserId]);
  }

  if (foreignUserId) {
    await db.query('DELETE FROM finances.payment_plan WHERE user_id = $1;', [foreignUserId]);
    await db.query('DELETE FROM finances.debt WHERE user_id = $1;', [foreignUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [foreignUserId]);
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
});

describe('US-010 Integration Test Suite: Payment Plans Engine & Strategies', () => {

  test('Scenario 1: Happy Path - POST /api/payment-plans/compare calculates all 5 strategies', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        extraMonthlyBudget: 150000,
        consolidationRateEA: 16.0,
        snowflakeAmount: 30000
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();

    // Summary checks
    assert.ok(body.summary);
    assert.equal(body.summary.totalDebts, 2);
    assert.equal(body.summary.totalCurrentDebt, 2500000);
    assert.ok(body.summary.totalBaseInstallments > 0, 'Must include totalBaseInstallments (US-021)');
    assert.ok(body.summary.baselineTotalInterest > 0);
    assert.ok(body.summary.baselineTotalMonths >= 24);
    assert.ok(['AVALANCHE', 'SNOWBALL'].includes(body.summary.optimalStrategy));
    assert.equal(body.summary.extraMonthlyBudget, 150000);

    // Strategies object checks
    assert.ok(body.strategies.AVALANCHE);
    assert.ok(body.strategies.SNOWBALL);
    assert.ok(body.strategies.TSUNAMI);
    assert.ok(body.strategies.CONSOLIDATION);
    assert.ok(body.strategies.SNOWFLAKE);

    // Avalanche must prioritize higher interest rate (debtHighRateId first)
    assert.equal(body.strategies.AVALANCHE.order[0], debtHighRateId);
    assert.equal(body.strategies.AVALANCHE.order[1], debtLowBalanceId);
    assert.ok(body.strategies.AVALANCHE.totalMonths < body.summary.baselineTotalMonths);
    assert.ok(body.strategies.AVALANCHE.totalSavings > 0);

    // US-021: Humanized sequence and freedom commitment metrics
    assert.ok(Array.isArray(body.strategies.AVALANCHE.sequence), 'Must include humanized sequence (US-021)');
    assert.equal(body.strategies.AVALANCHE.sequence.length, 2);
    assert.equal(body.strategies.AVALANCHE.sequence[0].name, 'Tarjeta Visa Black', 'Must render descriptive name without technical ID');
    assert.equal(body.strategies.AVALANCHE.sequence[0].priority, 1);
    assert.equal(body.strategies.AVALANCHE.monthlyFreedomCommitment, Math.round((body.summary.totalBaseInstallments + 150000) * 100) / 100);
    assert.equal(body.strategies.AVALANCHE.totalBaseInstallments, body.summary.totalBaseInstallments);
    assert.ok(body.strategies.AVALANCHE.priorityDebt);
    assert.equal(body.strategies.AVALANCHE.priorityDebt.name, 'Tarjeta Visa Black');
    assert.ok(body.strategies.AVALANCHE.monthlyInstruction.includes('Tarjeta Visa Black'));

    // Snowball must prioritize smaller balance (debtLowBalanceId first)
    assert.equal(body.strategies.SNOWBALL.order[0], debtLowBalanceId);
    assert.equal(body.strategies.SNOWBALL.order[1], debtHighRateId);
    assert.equal(body.strategies.SNOWBALL.sequence[0].name, 'Crédito Vehicular');
    assert.equal(body.strategies.SNOWBALL.priorityDebt.name, 'Crédito Vehicular');

    // Consolidation checks
    assert.equal(body.strategies.CONSOLIDATION.consolidatedRateEA, 16.0);
    assert.ok(body.strategies.CONSOLIDATION.totalMonths > 0);
    assert.ok(body.strategies.CONSOLIDATION.monthlyFreedomCommitment > 0);

    // Snowflake checks (has extra micro-savings, so totalMonths <= Avalanche)
    assert.ok(body.strategies.SNOWFLAKE.totalMonths <= body.strategies.AVALANCHE.totalMonths);

    // Debts array checks
    assert.equal(body.debts.length, 2);
    assert.ok(body.debts[0].monthlyPayment > 0);
    assert.ok(body.debts[0].name, 'Debts array items must include humanized name');
  });

  test('Scenario 2: Validation Failure - POST /api/payment-plans/compare rejects negative extraMonthlyBudget (422)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        extraMonthlyBudget: -50000
      })
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.status, 422);
    assert.ok(Array.isArray(body.invalid_params));
    const param = body.invalid_params.find(p => p.name === 'extraMonthlyBudget');
    assert.ok(param);
  });

  test('Scenario 3: Validation Failure - POST /api/payment-plans/compare rejects excessive consolidation rate (422)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        consolidationRateEA: 250
      })
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    const param = body.invalid_params.find(p => p.name === 'consolidationRateEA');
    assert.ok(param);
  });

  test('Scenario 4: Zero State - POST /api/payment-plans/compare for user without active debts returns empty response (200)', async () => {
    const token = makeToken(foreignUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.summary.totalDebts, 0);
    assert.equal(body.summary.totalCurrentDebt, 0);
    assert.equal(body.summary.optimalStrategy, 'NONE');
    assert.equal(body.debts.length, 0);
    assert.equal(body.strategies.AVALANCHE.totalMonths, 0);
  });

  test('Scenario 5: Authentication - POST /api/payment-plans/compare rejects requests without Bearer token (401)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.status, 401);
    assert.equal(body.title, 'No autorizado');
  });

  test('Scenario 6: Happy Path - POST /api/payment-plans saves chosen strategy (201)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        strategy: 'AVALANCHE',
        order: [debtHighRateId, debtLowBalanceId],
        extraMonthlyBudget: 120000,
        remainingAmount: 2500000
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.equal(body.user_id, testUserId);
    assert.equal(body.strategy, 'AVALANCHE');
    assert.deepEqual(body.order, [debtHighRateId, debtLowBalanceId]);
    assert.equal(body.extraMonthlyBudget, 120000);
    assert.equal(body.remainingamount, 2500000);
  });

  test('Scenario 7: Happy Path Update - POST /api/payment-plans updates existing plan (201)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        strategy: 'SNOWBALL',
        order: [debtLowBalanceId, debtHighRateId],
        extraMonthlyBudget: 180000
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.strategy, 'SNOWBALL');
    assert.deepEqual(body.order, [debtLowBalanceId, debtHighRateId]);
    assert.equal(body.extraMonthlyBudget, 180000);
  });

  test('Scenario 8: Validation Failure - POST /api/payment-plans rejects invalid strategy enum (422)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        strategy: 'INVALID_STRATEGY',
        order: [debtHighRateId]
      })
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.status, 422);
    const param = body.invalid_params.find(p => p.name === 'strategy');
    assert.ok(param);
  });

  test('Scenario 9: Validation Failure - POST /api/payment-plans rejects empty order array (422)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        strategy: 'AVALANCHE',
        order: []
      })
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    const param = body.invalid_params.find(p => p.name === 'order');
    assert.ok(param);
  });

  test('Scenario 10: Happy Path - GET /api/payment-plans/active returns active plan and sorted debts (200)', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans/active`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.plan);
    assert.equal(body.plan.userId, testUserId);
    assert.equal(body.plan.strategy, 'SNOWBALL');
    assert.equal(body.plan.strategyTitle, 'Método Bola de Nieve');
    assert.deepEqual(body.plan.order, [debtLowBalanceId, debtHighRateId]);
    assert.equal(body.plan.extraMonthlyBudget, 180000);

    // US-021: Freedom commitment metrics and humanized sequence in active plan
    assert.ok(body.plan.monthlyFreedomCommitment > 0, 'Must include monthlyFreedomCommitment');
    assert.ok(body.plan.totalBaseInstallments > 0, 'Must include totalBaseInstallments');
    assert.equal(body.plan.monthlyFreedomCommitment, Math.round((body.plan.totalBaseInstallments + 180000) * 100) / 100);
    assert.ok(Array.isArray(body.plan.sequence), 'Must include humanized sequence array');
    assert.equal(body.plan.sequence.length, 2);
    assert.equal(body.plan.sequence[0].name, 'Crédito Vehicular');
    assert.equal(body.plan.priorityDebt.name, 'Crédito Vehicular');
    assert.ok(body.plan.monthlyInstruction.includes('Crédito Vehicular'));

    // Active debts must be sorted according to plan order (debtLowBalanceId first)
    assert.equal(body.activeDebts.length, 2);
    assert.equal(body.activeDebts[0].id, debtLowBalanceId);
    assert.equal(body.activeDebts[0].name, 'Crédito Vehicular', 'Must include name in activeDebts');
    assert.equal(body.activeDebts[1].id, debtHighRateId);
    assert.equal(body.activeDebts[1].name, 'Tarjeta Visa Black');
  });

  test('Scenario 11: Zero State - GET /api/payment-plans/active returns plan: null for user without saved plan (200)', async () => {
    const token = makeToken(foreignUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans/active`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.plan, null);
    assert.ok(Array.isArray(body.activeDebts));
  });

  test('Scenario 12: Anti-IDOR Protection - GET /api/payment-plans/active?user_id=X for foreign user returns 403 Forbidden', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans/active?user_id=${foreignUserId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.status, 403);
    assert.equal(body.title, 'Acceso denegado');
  });

  test('Scenario 13: US-021 Fallback humanized name when debt name is empty defaults to category name without #id', async () => {
    paymentPlansService.invalidateCache();
    // Insert debt with null name
    const dRes = await db.query(`
      INSERT INTO finances.debt (user_id, category_id, name, loan_amount, interest_rate, numberofinstallments, installmentsleft, begin_date, status)
      VALUES ($1, $2, null, 300000.00, 10.0, 6, 6, '2026-11-01', true)
      RETURNING id;
    `, [testUserId, testCategoryId]);
    const namelessDebtId = parseInt(dRes.rows[0].id, 10);

    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ extraMonthlyBudget: 0 })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const namelessItem = body.debts.find(d => d.id === namelessDebtId);
    assert.ok(namelessItem);
    assert.equal(namelessItem.name, 'Tarjetas y Créditos', 'Must fallback to category name');
    assert.ok(!namelessItem.name.includes('#'), 'Must never include technical # character');

    // Clean up temporary debt & invalidate cache
    await db.query('DELETE FROM finances.debt WHERE id = $1;', [namelessDebtId]);
    paymentPlansService.invalidateCache();
  });

  test('Scenario 14: US-021 Dynamic monthly instruction adapts when extraMonthlyBudget is 0', async () => {
    const token = makeToken(testUserId);
    const res = await fetch(`http://localhost:${PORT}/api/payment-plans/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ extraMonthlyBudget: 0 })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const avStrat = body.strategies.AVALANCHE;
    assert.equal(avStrat.monthlyFreedomCommitment, avStrat.totalBaseInstallments);
    assert.ok(avStrat.monthlyInstruction.includes('cuotas mínimas pactadas'));
    assert.ok(avStrat.monthlyInstruction.includes(avStrat.priorityDebt.name));
  });

});
