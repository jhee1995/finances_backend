const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

describe('US-022 Integration Test Suite: User Isolation, Anti-IDOR and Anti-Enumeration', () => {
  let server;
  const PORT = 3192;
  let user1Id;
  let user2Id;
  const user1Email = `iso_user1_${Date.now()}@example.com`;
  const user2Email = `iso_user2_${Date.now()}@example.com`;

  before(async () => {
    await db.checkDatabaseConnection();
    await new Promise((resolve) => {
      server = app.listen(PORT, resolve);
    });

    // Create User 1 fixture
    const res1 = await fetch(`http://localhost:${PORT}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: 'Carlos',
        last_name: 'Gomez',
        email: user1Email
      })
    });
    const u1 = await res1.json();
    user1Id = u1.id;

    // Create User 2 fixture
    const res2 = await fetch(`http://localhost:${PORT}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: 'Maria',
        last_name: 'Rodriguez',
        email: user2Email
      })
    });
    const u2 = await res2.json();
    user2Id = u2.id;
  });

  after(async () => {
    if (user1Id) {
      await db.query('DELETE FROM finances.users WHERE id = $1;', [user1Id]);
    }
    if (user2Id) {
      await db.query('DELETE FROM finances.users WHERE id = $1;', [user2Id]);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('Scenario 1: Happy Path - GET /api/users/:id allows self-profile retrieval (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/users/${user1Id}`, {
      headers: { 'x-user-id': String(user1Id) }
    });
    assert.equal(res.status, 200);

    const user = await res.json();
    assert.equal(user.id, user1Id);
    assert.equal(user.email, user1Email);
    assert.equal(user.first_name, 'Carlos');
  });

  test('Scenario 2: Anti-IDOR Defense - GET /api/users/:id blocks access to another user profile (403 Forbidden)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/users/${user2Id}`, {
      headers: { 'x-user-id': String(user1Id) }
    });
    assert.equal(res.status, 403, 'Should reject access to foreign user profile');

    const problem = await res.json();
    assert.equal(problem.status, 403);
    assert.ok(problem.detail.includes('aislamiento IDOR') || problem.detail.includes('Acceso no autorizado'));
  });

  test('Scenario 3: Anti-Enumeration Defense - GET /api/users without email query is blocked (403 Forbidden)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/users`);
    assert.equal(res.status, 403, 'Should reject indiscriminate mass user listing');

    const problem = await res.json();
    assert.equal(problem.status, 403);
    assert.ok(problem.detail.includes('restringido'));
  });

  test('Scenario 4: Filtered Search - GET /api/users?email=... allows targeted email verification (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/users?email=${user1Email}`);
    assert.equal(res.status, 200);

    const users = await res.json();
    assert.ok(Array.isArray(users));
    assert.equal(users.length, 1);
    assert.equal(users[0].id, user1Id);
  });

  test('Scenario 5: Happy Path Update - PUT /api/users/:id updates self profile (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/users/${user1Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': String(user1Id)
      },
      body: JSON.stringify({
        first_name: 'Carlos Alberto',
        middle_name: 'Andres',
        last_name: 'Gomez Restrepo'
      })
    });
    assert.equal(res.status, 200);

    const updated = await res.json();
    assert.equal(updated.first_name, 'Carlos Alberto');
    assert.equal(updated.middle_name, 'Andres');
    assert.equal(updated.last_name, 'Gomez Restrepo');
  });

  test('Scenario 6: Anti-IDOR Update - PUT /api/users/:id blocks modifying another user profile (403 Forbidden)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/users/${user2Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': String(user1Id)
      },
      body: JSON.stringify({
        first_name: 'Hacked',
        last_name: 'User'
      })
    });
    assert.equal(res.status, 403);

    const problem = await res.json();
    assert.equal(problem.status, 403);
  });

  test('Scenario 7: Validation Failure - PUT /api/users/:id rejects empty fields (422 Unprocessable Entity)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/users/${user1Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': String(user1Id)
      },
      body: JSON.stringify({
        first_name: '',
        last_name: ''
      })
    });
    assert.equal(res.status, 422);

    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(Array.isArray(problem.invalid_params));
  });
});
