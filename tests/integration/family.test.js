const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

describe('US-011 Integration Test Suite: Family Core & Shared Finances', () => {
  let server;
  const PORT = 3096;
  const baseUrl = `http://localhost:${PORT}/api/family`;

  let testAdminUser;
  let testMemberUser;
  let testThirdUser;
  let testFamilyId;

  before(async () => {
    await db.checkDatabaseConnection();
    server = app.listen(PORT);

    // Create 3 isolated test users in Supabase
    const timestamp = Date.now();
    const adminRes = await db.query(`
      INSERT INTO finances.users (first_name, last_name, email, pass, family_core)
      VALUES ($1, $2, $3, $4, NULL)
      RETURNING id, email, first_name, last_name
    `, ['AdminFam', 'Test', `adminfam_${timestamp}@test.com`, 'hash123']);
    testAdminUser = adminRes.rows[0];

    const memberRes = await db.query(`
      INSERT INTO finances.users (first_name, last_name, email, pass, family_core)
      VALUES ($1, $2, $3, $4, NULL)
      RETURNING id, email, first_name, last_name
    `, ['MemberFam', 'Test', `memberfam_${timestamp}@test.com`, 'hash123']);
    testMemberUser = memberRes.rows[0];

    const thirdRes = await db.query(`
      INSERT INTO finances.users (first_name, last_name, email, pass, family_core)
      VALUES ($1, $2, $3, $4, NULL)
      RETURNING id, email, first_name, last_name
    `, ['ThirdFam', 'Test', `thirdfam_${timestamp}@test.com`, 'hash123']);
    testThirdUser = thirdRes.rows[0];
  });

  after(async () => {
    // Cleanup created family, debts, categories and users
    const userIds = [testAdminUser?.id, testMemberUser?.id, testThirdUser?.id].filter(Boolean);
    if (userIds.length > 0) {
      await db.query(`DELETE FROM finances.outcome WHERE user_id = ANY($1::bigint[])`, [userIds]);
      await db.query(`DELETE FROM finances.debt WHERE user_id = ANY($1::bigint[])`, [userIds]);
      await db.query(`DELETE FROM finances.categories WHERE user_id = ANY($1::bigint[])`, [userIds]);
    }
    if (testFamilyId) {
      await db.query('UPDATE finances.users SET family_core = NULL WHERE family_core = $1', [testFamilyId]);
      await db.query('DELETE FROM finances.family_core WHERE id = $1', [testFamilyId]);
    }
    if (userIds.length > 0) {
      await db.query(`DELETE FROM finances.users WHERE id = ANY($1::bigint[])`, [userIds]);
    }

    server.close();
    await db.close();
  });

  it('Scenario 1: Happy Path - POST /api/family creates family and auto-associates admin (201 Created)', async () => {
    const payload = {
      family_name: 'Familia Cardona Test',
      admin_user_id: Number(testAdminUser.id)
    };

    const res = await fetch(`${baseUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.equal(body.family_name, 'Familia Cardona Test');
    assert.equal(body.admin_user_id, Number(testAdminUser.id));
    assert.ok(Array.isArray(body.members));
    assert.equal(body.members.length, 1);
    assert.equal(body.members[0].id, Number(testAdminUser.id));
    assert.equal(body.members[0].is_admin, true);

    testFamilyId = body.id;

    // Verify in database that admin's family_core was updated
    const userCheck = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [testAdminUser.id]);
    assert.equal(Number(userCheck.rows[0].family_core), Number(testFamilyId));
  });

  it('Scenario 2: Validation Failure - POST /api/family rejects invalid family_name (422 ProblemDetails)', async () => {
    const res = await fetch(`${baseUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family_name: ' ',
        admin_user_id: 9999
      })
    });

    assert.equal(res.status, 422);
    assert.equal(res.headers.get('content-type'), 'application/problem+json; charset=utf-8');
    const body = await res.json();
    assert.equal(body.status, 422);
    assert.ok(Array.isArray(body.invalid_params));
    assert.ok(body.invalid_params.some(p => p.name === 'family_name'));
  });

  it('Scenario 3: Conflict - POST /api/family rejects if admin already belongs to a family (409 Conflict)', async () => {
    const res = await fetch(`${baseUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family_name: 'Familia Duplicada',
        admin_user_id: Number(testAdminUser.id)
      })
    });

    assert.equal(res.status, 409);
    assert.equal(res.headers.get('content-type'), 'application/problem+json; charset=utf-8');
    const body = await res.json();
    assert.equal(body.status, 409);
    assert.match(body.detail, /ya pertenece a un núcleo familiar/);
  });

  it('Scenario 4: Happy Path - GET /api/family/:id returns family details and members (200 OK)', async () => {
    const res = await fetch(`${baseUrl}/${testFamilyId}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, testFamilyId);
    assert.equal(body.family_name, 'Familia Cardona Test');
    assert.ok(Array.isArray(body.members));
    assert.equal(body.members[0].is_admin, true);
  });

  it('Scenario 5: Happy Path - GET /api/family/user/:userId returns family status for affiliated user (200 OK)', async () => {
    const res = await fetch(`${baseUrl}/user/${testAdminUser.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.in_family, true);
    assert.equal(body.is_admin, true);
    assert.ok(body.family);
    assert.equal(body.family.id, testFamilyId);
  });

  it('Scenario 6: Zero State - GET /api/family/user/:userId returns in_family: false for unaffiliated user (200 OK)', async () => {
    const res = await fetch(`${baseUrl}/user/${testMemberUser.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.in_family, false);
    assert.equal(body.is_admin, false);
    assert.equal(body.family, null);
  });

  it('Scenario 7: Happy Path - POST /api/family/:id/members associates member by email (200 OK)', async () => {
    const res = await fetch(`${baseUrl}/${testFamilyId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testMemberUser.email
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.members.length, 2);
    const added = body.members.find(m => m.id === Number(testMemberUser.id));
    assert.ok(added);
    assert.equal(added.is_admin, false);

    // Verify in DB
    const check = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [testMemberUser.id]);
    assert.equal(Number(check.rows[0].family_core), Number(testFamilyId));
  });

  it('Scenario 8: Conflict - POST /api/family/:id/members rejects user already in family (409 Conflict)', async () => {
    const res = await fetch(`${baseUrl}/${testFamilyId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testMemberUser.email
      })
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.status, 409);
    assert.match(body.detail, /ya es integrante/);
  });

  it('Scenario 9: Not Found - POST /api/family/:id/members rejects non-existent email (404 ProblemDetails)', async () => {
    const res = await fetch(`${baseUrl}/${testFamilyId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'inexistente999@noexiste.com'
      })
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.status, 404);
  });

  it('Scenario 10: Validation Failure - DELETE /api/family/:id/members/:userId rejects removing admin (422 ProblemDetails)', async () => {
    const res = await fetch(`${baseUrl}/${testFamilyId}/members/${testAdminUser.id}`, {
      method: 'DELETE'
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.status, 422);
    assert.ok(body.invalid_params.some(p => p.name === 'userId'));
  });

  it('Scenario 11: Happy Path - GET /api/family/:id/summary computes aggregated financial metrics (200 OK)', async () => {
    const res = await fetch(`${baseUrl}/${testFamilyId}/summary?year=2026`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.family_id, testFamilyId);
    assert.equal(body.family_name, 'Familia Cardona Test');
    assert.equal(body.member_count, 2);
    assert.equal(typeof body.total_family_income, 'number');
    assert.equal(typeof body.total_family_expenses, 'number');
    assert.equal(typeof body.net_family_balance, 'number');
    assert.equal(typeof body.total_family_debt, 'number');
    assert.ok(Array.isArray(body.members_contributions));
    assert.equal(body.members_contributions.length, 2);
  });

  let sharedCategoryId;
  let sharedDebtId;

  it('Scenario 12: Transversal Scope - Admin creates family category, Member discovers it (200 OK)', async () => {
    const catRes = await fetch(`http://localhost:${PORT}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `FamAlim_${Date.now()}`.substring(0, 19),
        percentage: 30,
        user_id: Number(testAdminUser.id)
      })
    });
    assert.equal(catRes.status, 201);
    const catData = await catRes.json();
    sharedCategoryId = catData.id;

    const listRes = await fetch(`http://localhost:${PORT}/api/categories?user_id=${testMemberUser.id}`);
    assert.equal(listRes.status, 200);
    const categories = await listRes.json();
    assert.ok(categories.some(c => c.id === sharedCategoryId));
  });

  it('Scenario 13: Co-Ownership - Member updates shared category percentage (200 OK)', async () => {
    const updateRes = await fetch(`http://localhost:${PORT}/api/categories/${sharedCategoryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        percentage: 45,
        user_id: Number(testMemberUser.id)
      })
    });
    assert.equal(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.equal(updated.percentage, 45);

    const checkRes = await fetch(`http://localhost:${PORT}/api/categories/${sharedCategoryId}`);
    assert.equal(checkRes.status, 200);
    const verified = await checkRes.json();
    assert.equal(verified.percentage, 45);
  });

  it('Scenario 14: Transversal Scope - Admin registers debt, Member discovers it (200 OK)', async () => {
    const debtRes = await fetch(`http://localhost:${PORT}/api/debts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: Number(testAdminUser.id),
        category_id: sharedCategoryId,
        loan_amount: 5000000,
        interest_rate: 15.5,
        numberOfInstallments: 12,
        installmentsLeft: 10,
        begin_date: '2026-01-15'
      })
    });
    assert.equal(debtRes.status, 201);
    const debtData = await debtRes.json();
    sharedDebtId = debtData.id;

    const debtsRes = await fetch(`http://localhost:${PORT}/api/debts?user_id=${testMemberUser.id}`);
    assert.equal(debtsRes.status, 200);
    const debts = await debtsRes.json();
    assert.ok(debts.some(d => d.id === sharedDebtId));
  });

  it('Scenario 15: Co-Management - Member amortizes cuotas of shared debt (200 OK)', async () => {
    const amortizeRes = await fetch(`http://localhost:${PORT}/api/debts/${sharedDebtId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installmentsLeft: 9,
        user_id: Number(testMemberUser.id)
      })
    });
    assert.equal(amortizeRes.status, 200);
    const updated = await amortizeRes.json();
    assert.equal(updated.installmentsLeft, 9);

    const adminViewRes = await fetch(`http://localhost:${PORT}/api/debts/${sharedDebtId}`);
    assert.equal(adminViewRes.status, 200);
    const adminDebt = await adminViewRes.json();
    assert.equal(adminDebt.installmentsLeft, 9);
  });

  it('Scenario 16: Multitenant Protection - Unrelated user is rejected from modifying family debt (422 ProblemDetails)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/debts/${sharedDebtId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installmentsLeft: 8,
        user_id: Number(testThirdUser.id)
      })
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.status, 422);
    assert.ok(body.invalid_params.some(p => p.name === 'user_id'));
  });

  it('Scenario 17: Multitenant Protection - Unrelated user is rejected from modifying family category (422 ProblemDetails)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/categories/${sharedCategoryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        percentage: 50,
        user_id: Number(testThirdUser.id)
      })
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.status, 422);
    assert.ok(body.invalid_params.some(p => p.name === 'user_id'));
  });

  it('Scenario 18: Co-Management - Member registers expense under shared family category (201 Created)', async () => {
    const expenseRes = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: Number(testMemberUser.id),
        category_id: sharedCategoryId,
        amount: 137119,
        date: '2026-10-15'
      })
    });
    assert.equal(expenseRes.status, 201, 'Member must be able to record expense on family category');
    const expenseData = await expenseRes.json();
    assert.ok(expenseData.id);
    assert.equal(expenseData.user_id, Number(testMemberUser.id));
    assert.equal(expenseData.category_id, sharedCategoryId);
    assert.equal(expenseData.amount, 137119);
  });

  it('Scenario 19: Multitenant Protection - Unrelated user cannot register expense under family category (422 ProblemDetails)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: Number(testThirdUser.id),
        category_id: sharedCategoryId,
        amount: 50000,
        date: '2026-10-15'
      })
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.status, 422);
    assert.ok(body.invalid_params.some(p => p.name === 'category_id'));
  });

  it('Scenario 20: Happy Path - DELETE /api/family/:id/members/:userId removes member (204 No Content)', async () => {
    const res = await fetch(`${baseUrl}/${testFamilyId}/members/${testMemberUser.id}`, {
      method: 'DELETE'
    });

    assert.equal(res.status, 204);

    const check = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [testMemberUser.id]);
    assert.equal(check.rows[0].family_core, null);
  });

  it('Scenario 21: Post-Departure Isolation - Unlinked member no longer receives family categories (200 OK)', async () => {
    const listRes = await fetch(`http://localhost:${PORT}/api/categories?user_id=${testMemberUser.id}`);
    assert.equal(listRes.status, 200);
    const categories = await listRes.json();
    assert.ok(!categories.some(c => c.id === sharedCategoryId));
  });

  it('Scenario 22: Not Found - GET /api/family/:id with non-existent ID (404 ProblemDetails)', async () => {
    const res = await fetch(`${baseUrl}/999999`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.status, 404);
  });

  it('Scenario 23: Validation Failure - Route parameters with non-numeric ID return 422 ProblemDetails', async () => {
    const res = await fetch(`${baseUrl}/abc`);
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.status, 422);
  });
});
