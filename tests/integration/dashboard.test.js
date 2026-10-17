const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3095;
let testUserId = null;
let emptyUserId = null;
let viviendaCatId = null;

before(async () => {
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  // 1. Create test user fixture with data
  const userRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('DashboardTest', 'User', 'dashboard.test.${Date.now()}@example.com')
    RETURNING id;
  `);
  testUserId = parseInt(userRes.rows[0].id, 10);

  // 2. Create categories for test user
  const catRes = await db.query(`
    INSERT INTO finances.categories (name, percentage, user_id)
    VALUES 
      ('Vivienda', 50, $1),
      ('Alimentación', 30, $1),
      ('Ahorro', 20, $1)
    RETURNING id, name;
  `, [testUserId]);
  
  const viviendaRow = catRes.rows.find(r => r.name === 'Vivienda');
  viviendaCatId = parseInt(viviendaRow.id, 10);

  // 3. Create test incomes for 2026 (Total: 3,500,000)
  await db.query(`
    INSERT INTO finances.cashflow (user_id, incomeamount, date)
    VALUES 
      ($1, 2000000.00, '2026-01-15'::date),
      ($1, 1500000.00, '2026-03-20'::date);
  `, [testUserId]);

  // 4. Create test expenses for 2026 (800,000 linked to Vivienda, 400,000 unlinked/historical)
  await db.query(`
    INSERT INTO finances.outcome (user_id, category_id, incomeamount, date)
    VALUES 
      ($1, $2, 800000.00, '2026-01-20'::date),
      ($1, NULL, 400000.00, '2026-03-25'::date);
  `, [testUserId, viviendaCatId]);

  // 5. Create test debt linked to Vivienda (2,400,000 at 24 cuotas, 20 left -> 4 cuotas paid = 400,000 amortized)
  await db.query(`
    INSERT INTO finances.debt (user_id, category_id, loan_amount, interest_rate, numberofinstallments, installmentsleft, begin_date, status)
    VALUES ($1, $2, 2400000.00, 22.5, 24, 20, '2026-01-10'::date, true);
  `, [testUserId, viviendaCatId]);

  // 6. Create empty user fixture (zero data)
  const emptyUserRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('EmptyDashboard', 'User', 'empty.dashboard.${Date.now()}@example.com')
    RETURNING id;
  `);
  emptyUserId = parseInt(emptyUserRes.rows[0].id, 10);
});

after(async () => {
  // Clean up fixtures
  if (testUserId) {
    await db.query('DELETE FROM finances.debt_payment WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.debt WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.cashflow WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.outcome WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.categories WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [testUserId]);
  }
  if (emptyUserId) {
    await db.query('DELETE FROM finances.users WHERE id = $1;', [emptyUserId]);
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
});

describe('US-006 / US-017 Integration Test Suite: Dashboard Analytics & Transversal Category Imputation', () => {

  test('Scenario 1: Happy Path - GET /api/dashboard/summary returns consolidated totals and series (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/dashboard/summary?user_id=${testUserId}&year=2026`);
    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const data = await res.json();

    assert.equal(data.user_id, testUserId);
    assert.equal(data.year, 2026);
    assert.equal(data.total_income, 3500000.00);
    assert.equal(data.total_expenses, 1200000.00);
    assert.equal(data.net_balance, 2300000.00);
    assert.equal(data.savings_rate, 65.71); // ((2300000 / 3500000) * 100).toFixed(2)

    // Check monthly continuous series of 12 months
    assert.ok(Array.isArray(data.monthly_metrics));
    assert.equal(data.monthly_metrics.length, 12);

    // Enero (month 1): income 2000000, expenses 800000, balance 1200000
    const jan = data.monthly_metrics.find(m => m.month === 1);
    assert.ok(jan);
    assert.equal(jan.income, 2000000.00);
    assert.equal(jan.expenses, 800000.00);
    assert.equal(jan.balance, 1200000.00);

    // Febrero (month 2): 0 transacciones
    const feb = data.monthly_metrics.find(m => m.month === 2);
    assert.ok(feb);
    assert.equal(feb.income, 0);
    assert.equal(feb.expenses, 0);
    assert.equal(feb.balance, 0);

    // Check categories distribution
    assert.ok(Array.isArray(data.categories_distribution));
    assert.equal(data.categories_distribution.length, 3);
    const catVivienda = data.categories_distribution.find(c => c.name === 'Vivienda');
    assert.ok(catVivienda);
    assert.equal(catVivienda.percentage, 50);
    assert.equal(catVivienda.allocated_amount, 1750000.00); // 3500000 * 0.50
    assert.equal(catVivienda.budgeted_amount, 1750000.00);
  });

  test('Scenario 2: Transversal Cross-Imputation - Category combines direct expenses and debt amortizations', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/dashboard/summary?user_id=${testUserId}&year=2026`);
    assert.equal(res.status, 200);
    const data = await res.json();

    const catVivienda = data.categories_distribution.find(c => c.name === 'Vivienda');
    assert.ok(catVivienda);
    assert.equal(catVivienda.direct_expenses, 800000.00, 'Direct expenses should match 800,000');
    assert.equal(catVivienda.debt_payments, 400000.00, 'Amortized debt should be 4 cuotas * 100,000 = 400,000');
    assert.equal(catVivienda.actual_spent, 1200000.00, 'Actual spent should be 800k + 400k = 1,200,000');
    assert.equal(catVivienda.execution_percentage, 68.57, '((1200000 / 1750000) * 100).toFixed(2)');
    assert.equal(catVivienda.is_overbudget, false);
    assert.equal(catVivienda.remaining_budget, 550000.00, '1750000 - 1200000 = 550,000');

    // Unused category (Ahorro)
    const catAhorro = data.categories_distribution.find(c => c.name === 'Ahorro');
    assert.ok(catAhorro);
    assert.equal(catAhorro.direct_expenses, 0.0);
    assert.equal(catAhorro.debt_payments, 0.0);
    assert.equal(catAhorro.actual_spent, 0.0);
    assert.equal(catAhorro.execution_percentage, 0.0);
    assert.equal(catAhorro.is_overbudget, false);
    assert.equal(catAhorro.remaining_budget, catAhorro.budgeted_amount);
  });

  test('Scenario 3: Zero Data State - GET /api/dashboard/summary for user without transactions returns 0 totals (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/dashboard/summary?user_id=${emptyUserId}&year=2026`);
    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const data = await res.json();

    assert.equal(data.total_income, 0);
    assert.equal(data.total_expenses, 0);
    assert.equal(data.net_balance, 0);
    assert.equal(data.savings_rate, 0);
    assert.equal(data.monthly_metrics.length, 12);
    assert.equal(data.monthly_metrics[0].income, 0);
    assert.equal(data.monthly_metrics[0].expenses, 0);
    assert.equal(data.categories_distribution.length, 0);
  });

  test('Scenario 4: Validation Error - Missing user_id returns HTTP 422 ProblemDetails', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/dashboard/summary`);
    assert.equal(res.status, 422);
    assert.equal(res.headers.get('content-type'), 'application/problem+json; charset=utf-8');
    const data = await res.json();
    assert.equal(data.status, 422);
    assert.ok(data.invalid_params.some(p => p.name === 'user_id'));
  });

  test('Scenario 5: Validation Error - Invalid year returns HTTP 422 ProblemDetails', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/dashboard/summary?user_id=${testUserId}&year=1800`);
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.ok(data.invalid_params.some(p => p.name === 'year'));
  });

  test('Scenario 6: Integrity Error - Non-existent user_id returns HTTP 422 ProblemDetails', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/dashboard/summary?user_id=99999999&year=2026`);
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.equal(data.detail, 'El usuario especificado no existe');
  });

  test('Scenario 7: US-019 Imputación de Abonos a Deudas en Balance General - net_balance descuenta debt_payments', async () => {
    const debtRes = await db.query('SELECT id FROM finances.debt WHERE user_id = $1 LIMIT 1;', [testUserId]);
    const debtId = debtRes.rows[0].id;

    // Insert payment of 500,000 in January 2026
    await db.query(`
      INSERT INTO finances.debt_payment (debt_id, user_id, amount, payment_date)
      VALUES ($1, $2, 500000.00, '2026-01-25'::date);
    `, [debtId, testUserId]);

    // Clear dashboard cache
    const dashboardService = require('../../src/modules/dashboard/dashboard.service');
    dashboardService._clearCache();

    const res = await fetch(`http://localhost:${PORT}/api/dashboard/summary?user_id=${testUserId}&year=2026`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.total_debt_payments, 500000.00);
    // Net balance: 3500000 - 1200000 - 500000 = 1800000.00
    assert.equal(data.net_balance, 1800000.00);

    const jan = data.monthly_metrics.find(m => m.month === 1);
    assert.equal(jan.debt_payments, 500000.00);
    // Jan balance: 2000000 - 800000 - 500000 = 700000.00
    assert.equal(jan.balance, 700000.00);
  });

});
