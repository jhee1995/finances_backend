const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3099;
let testUserId = null;
let testCategoryId = null;
let otherUserId = null;
let foreignCategoryId = null;
let createdDebtId = null;

before(async () => {
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  // [TEST DATA FIXTURE] Isolated test user & category
  const userRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('DebtTest', 'User', 'debt.test.${Date.now()}@example.com')
    RETURNING id;
  `);
  testUserId = parseInt(userRes.rows[0].id, 10);

  const catRes = await db.query(`
    INSERT INTO finances.categories (name, percentage, user_id)
    VALUES ('Tarjetas de Crédito', 25, $1)
    RETURNING id;
  `, [testUserId]);
  testCategoryId = parseInt(catRes.rows[0].id, 10);

  // [TEST DATA FIXTURE] Foreign user & foreign category (for cross-tenant checks)
  const otherRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('Foreign', 'User', 'foreign.test.${Date.now()}@example.com')
    RETURNING id;
  `);
  otherUserId = parseInt(otherRes.rows[0].id, 10);

  const foreignCatRes = await db.query(`
    INSERT INTO finances.categories (name, percentage, user_id)
    VALUES ('Vivienda Externa', 30, $1)
    RETURNING id;
  `, [otherUserId]);
  foreignCategoryId = parseInt(foreignCatRes.rows[0].id, 10);
});

after(async () => {
  if (testUserId) {
    await db.query('DELETE FROM finances.debt_payment WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.debt WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.categories WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [testUserId]);
  }

  if (otherUserId) {
    await db.query('DELETE FROM finances.debt_payment WHERE user_id = $1;', [otherUserId]);
    await db.query('DELETE FROM finances.debt WHERE user_id = $1;', [otherUserId]);
    await db.query('DELETE FROM finances.categories WHERE user_id = $1;', [otherUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [otherUserId]);
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
});

describe('US-016 Integration Test Suite: Categorized Debt Lifecycle & Obligations Management', () => {

  test('Scenario 1: Happy Path - POST /api/debts creates debt with mandatory category_id and default installmentsLeft (201 Created)', async () => {
    const payload = {
      user_id: testUserId,
      category_id: testCategoryId,
      loan_amount: 10000000,
      interest_rate: 28.5,
      numberOfInstallments: 24,
      begin_date: '2026-10-01'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201, 'Expected HTTP 201 Created');
    const data = await res.json();

    assert.ok(data.id, 'Response must include debt ID');
    assert.equal(data.user_id, testUserId);
    assert.equal(data.category_id, testCategoryId);
    assert.equal(data.category_name, 'Tarjetas de Crédito');
    assert.equal(data.loan_amount, 10000000);
    assert.equal(data.interest_rate, 28.5);
    assert.equal(data.numberOfInstallments, 24);
    assert.equal(data.installmentsLeft, 24, 'Default installmentsLeft must equal numberOfInstallments');
    assert.equal(data.begin_date, '2026-10-01');
    assert.equal(data.status, true, 'Default status must be true (active)');
    assert.ok(data.created_at, 'Must have created_at timestamp');

    createdDebtId = data.id;
  });

  test('Scenario 2: Normalization - POST /api/debts accepts custom installmentsLeft, categoryId and alternative casing', async () => {
    const payload = {
      user_id: testUserId,
      categoryId: testCategoryId,
      loanAmount: 5000000,
      interestRate: 22.0,
      number_of_installments: 12,
      installments_left: 8,
      beginDate: '2026-05-15'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201, 'Expected HTTP 201 Created');
    const data = await res.json();

    assert.equal(data.loan_amount, 5000000);
    assert.equal(data.category_id, testCategoryId);
    assert.equal(data.category_name, 'Tarjetas de Crédito');
    assert.equal(data.interest_rate, 22.0);
    assert.equal(data.numberOfInstallments, 12);
    assert.equal(data.installmentsLeft, 8);
    assert.equal(data.begin_date, '2026-05-15');
  });

  test('Scenario 3: Validation Failure - POST /api/debts rejects installmentsLeft > numberOfInstallments (422 ProblemDetails)', async () => {
    const payload = {
      user_id: testUserId,
      category_id: testCategoryId,
      loan_amount: 3000000,
      interest_rate: 18.0,
      numberOfInstallments: 12,
      installmentsLeft: 15,
      begin_date: '2026-10-01'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 Unprocessable Content');
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(Array.isArray(problem.invalid_params));
    assert.ok(problem.invalid_params.some(p => p.name.includes('installmentsLeft')));
  });

  test('Scenario 4: Validation Failure - POST /api/debts rejects loan_amount <= 0 and negative interest_rate (422 ProblemDetails)', async () => {
    const payload = {
      user_id: testUserId,
      category_id: testCategoryId,
      loan_amount: 0,
      interest_rate: -5,
      numberOfInstallments: 24,
      begin_date: 'invalid-date'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(Array.isArray(problem.invalid_params));
    assert.ok(problem.invalid_params.length >= 2);
  });

  test('Scenario 5: Integrity Error - POST /api/debts rejects non-existent user_id (422 ProblemDetails)', async () => {
    const payload = {
      user_id: 999999,
      category_id: testCategoryId,
      loan_amount: 2000000,
      interest_rate: 20.0,
      numberOfInstallments: 12,
      begin_date: '2026-10-01'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'user_id'));
  });

  test('Scenario 6: Happy Path - GET /api/debts filters by user_id, status and category_id (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/debts?user_id=${testUserId}&status=true&category_id=${testCategoryId}`);
    assert.equal(res.status, 200);
    const debts = await res.json();

    assert.ok(Array.isArray(debts));
    assert.ok(debts.length >= 2);
    debts.forEach(d => {
      assert.equal(d.user_id, testUserId);
      assert.equal(d.status, true);
      assert.equal(d.category_id, testCategoryId);
      assert.equal(d.category_name, 'Tarjetas de Crédito');
    });
  });

  test('Scenario 7: Happy Path - GET /api/debts/:id returns single debt with category metadata (200 OK) and 404 for missing ID', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/debts/${createdDebtId}`);
    assert.equal(res.status, 200);
    const debt = await res.json();

    assert.equal(debt.id, createdDebtId);
    assert.equal(debt.loan_amount, 10000000);
    assert.equal(debt.category_id, testCategoryId);
    assert.equal(debt.category_name, 'Tarjetas de Crédito');

    const notFoundRes = await fetch(`http://localhost:${PORT}/api/debts/999999`);
    assert.equal(notFoundRes.status, 404);
    const problem = await notFoundRes.json();
    assert.equal(problem.status, 404);
  });

  test('Scenario 8: Happy Path - PUT /api/debts/:id updates cuotas and category_id (200 OK & 422)', async () => {
    // Valid update: amortize to 18 cuotas left and keep category
    const res = await fetch(`http://localhost:${PORT}/api/debts/${createdDebtId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installmentsLeft: 18, category_id: testCategoryId })
    });

    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.installmentsLeft, 18);
    assert.equal(updated.category_id, testCategoryId);
    assert.equal(updated.category_name, 'Tarjetas de Crédito');

    // Invalid update: installmentsLeft > numberOfInstallments
    const errRes = await fetch(`http://localhost:${PORT}/api/debts/${createdDebtId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installmentsLeft: 99 })
    });
    assert.equal(errRes.status, 422);
  });

  test('Scenario 9: Auto-Settlement - PUT /api/debts/:id with installmentsLeft=0 sets status to false (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/debts/${createdDebtId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installmentsLeft: 0 })
    });

    assert.equal(res.status, 200);
    const settled = await res.json();
    assert.equal(settled.installmentsLeft, 0);
    assert.equal(settled.status, false, 'Debt must automatically transition to inactive/settled');
  });

  test('Scenario 10: Happy Path - DELETE /api/debts/:id removes debt (204 No Content) and 404 on repeat', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/debts/${createdDebtId}`, {
      method: 'DELETE'
    });

    assert.equal(res.status, 204, 'Expected HTTP 204 No Content');

    const repeatRes = await fetch(`http://localhost:${PORT}/api/debts/${createdDebtId}`, {
      method: 'DELETE'
    });
    assert.equal(repeatRes.status, 404, 'Expected HTTP 404 on deleted ID');
  });

  test('Scenario 11: Route Parameter Validation - GET/PUT/DELETE /api/debts/:id with invalid ID format returns 422 ProblemDetails', async () => {
    const invalidIdRes = await fetch(`http://localhost:${PORT}/api/debts/invalid-id`);
    assert.equal(invalidIdRes.status, 422);
    const problem = await invalidIdRes.json();
    assert.equal(problem.status, 422);

    const invalidPutRes = await fetch(`http://localhost:${PORT}/api/debts/invalid-id`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installmentsLeft: 5 })
    });
    assert.equal(invalidPutRes.status, 422);

    const invalidDelRes = await fetch(`http://localhost:${PORT}/api/debts/invalid-id`, {
      method: 'DELETE'
    });
    assert.equal(invalidDelRes.status, 422);
  });

  test('Scenario 12: Query Parameter Validation - GET /api/debts with invalid user_id or category_id returns 422 ProblemDetails', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/debts?user_id=invalid`);
    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);

    const catRes = await fetch(`http://localhost:${PORT}/api/debts?category_id=invalid`);
    assert.equal(catRes.status, 422);
  });

  test('Scenario 13: Validation Failure - POST /api/debts rejects missing category_id (422 ProblemDetails)', async () => {
    const payload = {
      user_id: testUserId,
      loan_amount: 1500000,
      interest_rate: 20.0,
      numberOfInstallments: 12,
      begin_date: '2026-10-01'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 when category_id is missing');
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'category_id'));
  });

  test('Scenario 14: Integrity Failure - POST /api/debts rejects non-existent category_id (422 ProblemDetails)', async () => {
    const payload = {
      user_id: testUserId,
      category_id: 999999,
      loan_amount: 1500000,
      interest_rate: 20.0,
      numberOfInstallments: 12,
      begin_date: '2026-10-01'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 for non-existent category_id');
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'category_id'));
  });

  test('Scenario 15: Cross-Tenant Protection - POST /api/debts rejects category_id belonging to another user (422 ProblemDetails)', async () => {
    const payload = {
      user_id: testUserId,
      category_id: foreignCategoryId,
      loan_amount: 1500000,
      interest_rate: 20.0,
      numberOfInstallments: 12,
      begin_date: '2026-10-01'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 for cross-tenant category');
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'category_id'));
  });

});

describe('US-009 Integration Test Suite: Debt Simulator & Amortization Schedules (DEB-006)', () => {
  let validToken;
  let foreignToken;
  let testDebtId;

  before(async () => {
    validToken = Buffer.from(`${testUserId}:${Date.now()}:debt.test@example.com`).toString('base64');
    foreignToken = Buffer.from(`${otherUserId}:${Date.now()}:foreign.test@example.com`).toString('base64');

    // [TEST DATA FIXTURE] Seed a real debt for debtId tests
    const debtRes = await db.query(`
      INSERT INTO finances.debt (user_id, category_id, loan_amount, interest_rate, numberofinstallments, installmentsleft, begin_date, status)
      VALUES ($1, $2, 8000000, 22.0, 18, 18, '2026-11-01', true)
      RETURNING id;
    `, [testUserId, testCategoryId]);
    testDebtId = parseInt(debtRes.rows[0].id, 10);
  });

  after(async () => {
    if (testDebtId) {
      await db.query('DELETE FROM finances.debt WHERE id = $1;', [testDebtId]);
    }
  });

  test('Scenario 1: Happy Path - French Amortization Simulation (HTTP 200)', async () => {
    const payload = {
      amount: 10000000,
      interestRateEA: 25.0,
      installments: 12,
      beginDate: '2026-11-01',
      system: 'FRENCH'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 200, 'Expected HTTP 200 for valid simulation');
    const data = await res.json();

    assert.ok(data.summary);
    assert.equal(data.summary.loanAmount, 10000000);
    assert.equal(data.summary.effectiveTerm, 12);
    assert.equal(data.summary.system, 'FRENCH');
    assert.equal(data.summary.nominalMonthlyRate, 1.8769);
    assert.equal(data.summary.monthlyPayment, 938463.26);
    assert.equal(data.summary.totalPrincipal, 10000000);
    assert.ok(data.summary.totalInterest > 0);
    assert.equal(data.summary.totalPaid, Math.round((data.summary.totalPrincipal + data.summary.totalInterest) * 100) / 100);

    assert.equal(data.amortizationTable.length, 12);
    const lastRow = data.amortizationTable[11];
    assert.equal(lastRow.endingBalance, 0);
    assert.equal(lastRow.principalAmount, lastRow.initialBalance);
  });

  test('Scenario 2: Zero Interest Rate (0% EA) Simulation (HTTP 200)', async () => {
    const payload = {
      amount: 6000000,
      interestRateEA: 0.0,
      installments: 6,
      beginDate: '2026-11-01'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.summary.totalInterest, 0);
    assert.equal(data.summary.monthlyPayment, 1000000);
    assert.equal(data.summary.nominalMonthlyRate, 0);
    assert.equal(data.amortizationTable.length, 6);

    data.amortizationTable.forEach(row => {
      assert.equal(row.interestAmount, 0);
      assert.equal(row.principalAmount, 1000000);
    });
    assert.equal(data.amortizationTable[5].endingBalance, 0);
  });

  test('Scenario 3: German System Simulation (Constant Principal) (HTTP 200)', async () => {
    const payload = {
      amount: 12000000,
      interestRateEA: 20.0,
      installments: 12,
      beginDate: '2026-11-01',
      system: 'GERMAN'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.summary.system, 'GERMAN');
    assert.equal(data.amortizationTable.length, 12);

    // In German system, principal amount is constant across standard rows
    for (let i = 0; i < 11; i++) {
      assert.equal(data.amortizationTable[i].principalAmount, 1000000);
    }
    // Installment amount decreases over time
    assert.ok(data.amortizationTable[0].installmentAmount > data.amortizationTable[11].installmentAmount);
    assert.equal(data.amortizationTable[11].endingBalance, 0);
  });

  test('Scenario 4: Extra Payment - REDUCE_TERM (HTTP 200)', async () => {
    const payload = {
      amount: 10000000,
      interestRateEA: 20.0,
      installments: 24,
      beginDate: '2026-11-01',
      system: 'FRENCH',
      extraPayments: [
        {
          installmentNumber: 3,
          amount: 3000000,
          type: 'REDUCE_TERM'
        }
      ]
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.ok(data.summary.effectiveTerm < 24, `Term should be less than 24, got ${data.summary.effectiveTerm}`);
    assert.equal(data.summary.totalExtraPayments, 3000000);
    assert.equal(data.summary.totalPrincipal, 10000000);
    assert.equal(data.amortizationTable[data.amortizationTable.length - 1].endingBalance, 0);
  });

  test('Scenario 5: Extra Payment - REDUCE_PAYMENT (HTTP 200)', async () => {
    const payload = {
      amount: 10000000,
      interestRateEA: 20.0,
      installments: 24,
      beginDate: '2026-11-01',
      system: 'FRENCH',
      extraPayments: [
        {
          installmentNumber: 3,
          amount: 3000000,
          type: 'REDUCE_PAYMENT'
        }
      ]
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.summary.effectiveTerm, 24);
    // Installment 4 should be lower than installment 2 due to payment reduction
    const installment2Payment = data.amortizationTable[1].installmentAmount;
    const installment4Payment = data.amortizationTable[3].installmentAmount;
    assert.ok(installment4Payment < installment2Payment, `Expected ${installment4Payment} < ${installment2Payment}`);
    assert.equal(data.amortizationTable[23].endingBalance, 0);
  });

  test('Scenario 6: Validation Failure - installments exceeds 360 (HTTP 422)', async () => {
    const payload = {
      amount: 5000000,
      interestRateEA: 15.0,
      installments: 400
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'installments'));
  });

  test('Scenario 7: Validation Failure - negative amount or negative rate (HTTP 422)', async () => {
    const payload = {
      amount: -1000,
      interestRateEA: -5.0,
      installments: 12
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'amount' || p.name === 'interestRateEA'));
  });

  test('Scenario 8: Unauthorized Access - Missing Authorization header (HTTP 401 ProblemDetails)', async () => {
    const payload = {
      amount: 5000000,
      interestRateEA: 15.0,
      installments: 12
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 401);
    const problem = await res.json();
    assert.equal(problem.status, 401);
    assert.equal(problem.title, 'No autenticado');
  });

  test('Scenario 9: Simulation referencing existing debtId (HTTP 200)', async () => {
    const payload = {
      debtId: testDebtId
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.summary.loanAmount, 8000000);
    assert.equal(data.summary.interestRateEA, 22.0);
    assert.equal(data.summary.effectiveTerm, 18);
    assert.equal(data.amortizationTable.length, 18);
  });

  test('Scenario 10: Forbidden - Simulating on foreign debtId (HTTP 403 ProblemDetails)', async () => {
    const payload = {
      debtId: testDebtId
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${foreignToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 403);
    const problem = await res.json();
    assert.equal(problem.status, 403);
    assert.equal(problem.title, 'Acceso denegado');
  });

  test('Scenario 11: Not Found - Simulating on non-existent debtId (HTTP 404 ProblemDetails)', async () => {
    const payload = {
      debtId: 9999999
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 404);
    const problem = await res.json();
    assert.equal(problem.status, 404);
    assert.equal(problem.title, 'Obligación no encontrada');
  });

  test('Scenario 12: US-018 Happy Path - POST /api/debts creates debt with descriptive name', async () => {
    const payload = {
      user_id: testUserId,
      category_id: testCategoryId,
      name: 'Crédito Vehicular Mazda 3',
      loan_amount: 45000000,
      interest_rate: 16.5,
      numberOfInstallments: 60,
      begin_date: '2026-10-01'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, 'Crédito Vehicular Mazda 3');
  });

  test('Scenario 13: US-018 Default Fallback - POST /api/debts without name defaults to Obligación Financiera', async () => {
    const payload = {
      user_id: testUserId,
      category_id: testCategoryId,
      loan_amount: 5000000,
      interest_rate: 22.0,
      numberOfInstallments: 12,
      begin_date: '2026-10-01'
    };

    const res = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, 'Obligación Financiera');
  });

  test('Scenario 14: US-018 Validation Failure - POST /api/debts rejects empty name or length > 100', async () => {
    const emptyPayload = {
      user_id: testUserId,
      category_id: testCategoryId,
      name: '   ',
      loan_amount: 2000000,
      interest_rate: 18.0,
      numberOfInstallments: 12,
      begin_date: '2026-10-01'
    };

    const resEmpty = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emptyPayload)
    });

    assert.equal(resEmpty.status, 422);

    const longPayload = {
      user_id: testUserId,
      category_id: testCategoryId,
      name: 'D'.repeat(101),
      loan_amount: 2000000,
      interest_rate: 18.0,
      numberOfInstallments: 12,
      begin_date: '2026-10-01'
    };

    const resLong = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(longPayload)
    });

    assert.equal(resLong.status, 422);
  });

  test('Scenario 15: US-018 Happy Path Update - PUT /api/debts/:id updates name', async () => {
    const createRes = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        category_id: testCategoryId,
        name: 'Préstamo Libre Inversión',
        loan_amount: 8000000,
        interest_rate: 19.5,
        numberOfInstallments: 24,
        begin_date: '2026-10-01'
      })
    });
    const created = await createRes.json();

    const updateRes = await fetch(`http://localhost:${PORT}/api/debts/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        name: 'Préstamo Banco Agrario Libre Inversión'
      })
    });

    assert.equal(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.equal(updated.name, 'Préstamo Banco Agrario Libre Inversión');
  });

  test('Scenario 16: US-019 - GET /api/debts includes calculated monthlyPayment', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/debts?user_id=${testUserId}`);
    assert.equal(res.status, 200);
    const debts = await res.json();
    assert.ok(debts.length > 0);
    const debt = debts[0];
    assert.ok(debt.monthlyPayment !== undefined, 'monthlyPayment should be present');
    assert.ok(typeof debt.monthlyPayment === 'number');
    assert.ok(debt.monthlyPayment > 0);
  });

  test('Scenario 17: US-019 - POST /api/debts/:id/payments registers exact monthly installment', async () => {
    // Create fresh debt: 3,000,000, 18% EA, 12 installments
    const createRes = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        category_id: testCategoryId,
        name: 'Crédito Moto Yamaha',
        loan_amount: 3000000,
        interest_rate: 18.0,
        numberOfInstallments: 12,
        begin_date: '2026-10-01'
      })
    });
    assert.equal(createRes.status, 201);
    const debt = await createRes.json();
    const suggestedPayment = debt.monthlyPayment;

    // Register payment of exact monthlyPayment
    const payRes = await fetch(`http://localhost:${PORT}/api/debts/${debt.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        amount: suggestedPayment,
        payment_date: '2026-10-16'
      })
    });

    assert.equal(payRes.status, 201);
    const data = await payRes.json();

    assert.ok(data.payment);
    assert.equal(data.payment.debt_id, debt.id);
    assert.equal(data.payment.amount, suggestedPayment);
    assert.equal(data.payment.payment_date, '2026-10-16');

    assert.ok(data.debt);
    assert.equal(data.debt.installmentsLeft, 11);
    assert.ok(data.debt.loan_amount < 3000000);
    assert.equal(data.recalculation.is_fully_paid, false);
    assert.equal(data.recalculation.installments_left, 11);
  });

  test('Scenario 18: US-019 - POST /api/debts/:id/payments registers partial payment with recalculation', async () => {
    const createRes = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        category_id: testCategoryId,
        name: 'Crédito Computador',
        loan_amount: 2000000,
        interest_rate: 15.0,
        numberOfInstallments: 10,
        begin_date: '2026-10-01'
      })
    });
    const debt = await createRes.json();

    // Partial payment of 100,000 (less than suggested ~214k)
    const payRes = await fetch(`http://localhost:${PORT}/api/debts/${debt.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        amount: 100000,
        payment_date: '2026-10-16'
      })
    });

    assert.equal(payRes.status, 201);
    const data = await payRes.json();

    assert.equal(data.payment.amount, 100000);
    assert.ok(data.recalculation.principal_portion > 0);
    assert.ok(data.recalculation.interest_portion > 0);
    assert.equal(data.recalculation.new_balance, data.debt.loan_amount);
    assert.ok(data.debt.loan_amount < 2000000);
    assert.ok(data.debt.monthlyPayment > 0);
  });

  test('Scenario 19: US-019 - POST /api/debts/:id/payments registers full payoff payment', async () => {
    const createRes = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        category_id: testCategoryId,
        name: 'Microcrédito Rápido',
        loan_amount: 50000,
        interest_rate: 10.0,
        numberOfInstallments: 2,
        begin_date: '2026-10-01'
      })
    });
    const debt = await createRes.json();

    // Pay full amount (100,000 covers full balance + interest)
    const payRes = await fetch(`http://localhost:${PORT}/api/debts/${debt.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        amount: 60000,
        payment_date: '2026-10-16'
      })
    });

    assert.equal(payRes.status, 201);
    const data = await payRes.json();

    assert.equal(data.debt.status, false, 'Debt status should be inactive/liquidated');
    assert.equal(data.debt.loan_amount, 0);
    assert.equal(data.debt.installmentsLeft, 0);
    assert.equal(data.recalculation.is_fully_paid, true);
    assert.equal(data.recalculation.new_balance, 0);
  });

  test('Scenario 20: US-019 - GET /api/debts/:id/payments returns chronological payment history', async () => {
    const createRes = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUserId,
        category_id: testCategoryId,
        name: 'Crédito Electrodomésticos',
        loan_amount: 1000000,
        interest_rate: 12.0,
        numberOfInstallments: 6,
        begin_date: '2026-10-01'
      })
    });
    const debt = await createRes.json();

    // Make 2 payments
    await fetch(`http://localhost:${PORT}/api/debts/${debt.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: testUserId, amount: 150000, payment_date: '2026-10-05' })
    });

    await fetch(`http://localhost:${PORT}/api/debts/${debt.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: testUserId, amount: 200000, payment_date: '2026-10-15' })
    });

    const histRes = await fetch(`http://localhost:${PORT}/api/debts/${debt.id}/payments`);
    assert.equal(histRes.status, 200);
    const history = await histRes.json();

    assert.ok(Array.isArray(history));
    assert.equal(history.length, 2);
    // Descending order by date
    assert.equal(history[0].payment_date, '2026-10-15');
    assert.equal(history[0].amount, 200000);
    assert.equal(history[1].payment_date, '2026-10-05');
    assert.equal(history[1].amount, 150000);
  });

  test('Scenario 21: US-019 - Validation errors on invalid payment amount or date (422)', async () => {
    const debtsRes = await fetch(`http://localhost:${PORT}/api/debts?user_id=${testUserId}`);
    const debts = await debtsRes.json();
    const debtId = debts[0].id;

    // Negative amount
    const resNegative = await fetch(`http://localhost:${PORT}/api/debts/${debtId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: testUserId, amount: -5000 })
    });
    assert.equal(resNegative.status, 422);

    // Zero amount
    const resZero = await fetch(`http://localhost:${PORT}/api/debts/${debtId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: testUserId, amount: 0 })
    });
    assert.equal(resZero.status, 422);

    // Invalid date
    const resDate = await fetch(`http://localhost:${PORT}/api/debts/${debtId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: testUserId, amount: 50000, payment_date: 'fecha-erronea' })
    });
    assert.equal(resDate.status, 422);
  });

  test('Scenario 22: US-019 - Multitenant isolation: cannot pay or consult foreign debt (404)', async () => {
    // Create foreign debt for otherUserId
    const foreignDebtRes = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: otherUserId,
        category_id: foreignCategoryId,
        name: 'Deuda Privada Vecino',
        loan_amount: 5000000,
        interest_rate: 20.0,
        numberOfInstallments: 12,
        begin_date: '2026-10-01'
      })
    });
    const foreignDebt = await foreignDebtRes.json();

    // testUserId tries to pay otherUserId debt
    const payRes = await fetch(`http://localhost:${PORT}/api/debts/${foreignDebt.id}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Buffer.from(`${testUserId}:token`).toString('base64')}`
      },
      body: JSON.stringify({
        user_id: testUserId,
        amount: 250000
      })
    });
    assert.equal(payRes.status, 404, 'Foreign debt payment should be rejected with 404 Not Found');

    // testUserId tries to list payments of otherUserId debt
    const listRes = await fetch(`http://localhost:${PORT}/api/debts/${foreignDebt.id}/payments`, {
      headers: {
        'Authorization': `Bearer ${Buffer.from(`${testUserId}:token`).toString('base64')}`
      }
    });
    assert.equal(listRes.status, 404, 'Foreign debt payment listing should be rejected with 404 Not Found');
  });

});
