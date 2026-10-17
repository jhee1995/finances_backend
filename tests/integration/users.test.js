const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3095;
const TEST_TIMESTAMP = Date.now();
const TEST_EMAIL = `test.user.${TEST_TIMESTAMP}@example.com`;
let createdUserId = null;

before(async () => {
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });
});

after(async () => {
  // Cleanup test user from finances.users if created
  if (createdUserId) {
    await db.query('DELETE FROM finances.users WHERE id = $1;', [createdUserId]);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
});

describe('US-002 Integration Test Suite: User Registration & Profiles', () => {

  test('Scenario 1: Happy Path - POST /api/users creates user in Supabase (201 Created)', async () => {
    const payload = {
      first_name: 'Carlos',
      middle_name: 'Andres',
      last_name: 'Gomez',
      email: TEST_EMAIL
    };

    const res = await fetch(`http://localhost:${PORT}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201, 'Expected HTTP 201 Created');
    const user = await res.json();

    assert.ok(user.id, 'User must have an auto-generated ID');
    assert.equal(user.first_name, 'Carlos');
    assert.equal(user.middle_name, 'Andres');
    assert.equal(user.last_name, 'Gomez');
    assert.equal(user.email, TEST_EMAIL);
    assert.ok(user.created_at, 'User must have created_at timestamp');

    createdUserId = user.id;
  });

  test('Scenario 2: Validation Failure - POST /api/users returns 422 for invalid email or missing fields', async () => {
    const invalidPayload = {
      first_name: '', // Empty
      last_name: 'Gomez',
      email: 'not-an-email' // Malformed
    };

    const res = await fetch(`http://localhost:${PORT}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 Unprocessable Entity');
    const problem = await res.json();

    assert.equal(problem.status, 422);
    assert.ok(Array.isArray(problem.invalid_params));
    assert.ok(problem.invalid_params.some(p => p.name === 'first_name'));
    assert.ok(problem.invalid_params.some(p => p.name === 'email'));
  });

  test('Scenario 3: Conflict - POST /api/users returns 409 when email already exists', async () => {
    const duplicatePayload = {
      first_name: 'Otro',
      last_name: 'Usuario',
      email: TEST_EMAIL // Duplicate
    };

    const res = await fetch(`http://localhost:${PORT}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(duplicatePayload)
    });

    assert.equal(res.status, 409, 'Expected HTTP 409 Conflict');
    const problem = await res.json();

    assert.equal(problem.status, 409);
    assert.ok(problem.detail.includes(TEST_EMAIL));
  });

  test('Scenario 4: Retrieval - GET /api/users/:id returns user by existing ID (200 OK)', async () => {
    assert.ok(createdUserId, 'Precondition: createdUserId must be set');

    const res = await fetch(`http://localhost:${PORT}/api/users/${createdUserId}`);
    assert.equal(res.status, 200, 'Expected HTTP 200 OK');

    const user = await res.json();
    assert.equal(user.id, createdUserId);
    assert.equal(user.email, TEST_EMAIL);
  });

  test('Scenario 5: Not Found - GET /api/users/:id returns 404 for non-existent ID', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/users/9999999`);
    assert.equal(res.status, 404, 'Expected HTTP 404 Not Found');

    const problem = await res.json();
    assert.equal(problem.status, 404);
  });

  test('Scenario 6: Listing - GET /api/users returns array of registered users', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/users?email=${TEST_EMAIL}`);
    assert.equal(res.status, 200);

    const users = await res.json();
    assert.ok(Array.isArray(users));
    assert.ok(users.length >= 1);
    assert.equal(users[0].id, createdUserId);
  });

});
