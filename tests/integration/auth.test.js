const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3098;
const TEST_TIMESTAMP = Date.now();
const TEST_EMAIL = `auth.test.${TEST_TIMESTAMP}@example.com`;
const TEST_PASSWORD = 'CustomPassword2026!';
let registeredUserId = null;

before(async () => {
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });
});

after(async () => {
  if (registeredUserId) {
    await db.query('DELETE FROM finances.users WHERE id = $1;', [registeredUserId]);
  }
  await db.query('DELETE FROM finances.users WHERE email LIKE $1;', [`auth.test.%@example.com`]);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
});

describe('US-014 Integration Test Suite: Authentication with Argon2id', () => {

  test('Scenario 1: Happy Path Login with default password (pass123) (200 OK)', async () => {
    const payload = {
      email: 'jhee.stev@gmail.com',
      password: 'pass123'
    };

    const res = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const data = await res.json();

    assert.equal(data.message, 'Autenticación exitosa');
    assert.ok(data.token, 'Must return authentication token');
    assert.ok(data.user, 'Must return user object');
    assert.equal(data.user.email, 'jhee.stev@gmail.com');
    assert.equal(data.user.pass, undefined, 'Zero leakage: pass property must never be returned');
  });

  test('Scenario 2: Login Failure with incorrect password (401 Unauthorized)', async () => {
    const payload = {
      email: 'jhee.stev@gmail.com',
      password: 'wrong-password-123'
    };

    const res = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 401, 'Expected HTTP 401 Unauthorized');
    const problem = await res.json();

    assert.equal(problem.status, 401);
    assert.equal(problem.detail, 'Credenciales inválidas');
  });

  test('Scenario 3: Login Failure with non-existent email (401 Unauthorized)', async () => {
    const payload = {
      email: 'nonexistent.user.999@example.com',
      password: 'anyPassword123'
    };

    const res = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 401, 'Expected HTTP 401 Unauthorized');
    const problem = await res.json();

    assert.equal(problem.status, 401);
    assert.equal(problem.detail, 'Credenciales inválidas');
  });

  test('Scenario 4: Login Validation Failure with missing fields (422 ProblemDetails)', async () => {
    const invalidPayload = {
      email: 'not-an-email'
    };

    const res = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 Unprocessable Entity');
    const problem = await res.json();

    assert.equal(problem.status, 422);
    assert.ok(Array.isArray(problem.invalid_params));
    assert.ok(problem.invalid_params.some(p => p.name === 'email'));
    assert.ok(problem.invalid_params.some(p => p.name === 'password'));
  });

  test('Scenario 5: Register User with Custom Password and Argon2id Hashing (201 Created)', async () => {
    const registerPayload = {
      first_name: 'Test',
      last_name: 'ArgonUser',
      email: TEST_EMAIL,
      password: TEST_PASSWORD
    };

    const res = await fetch(`http://localhost:${PORT}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerPayload)
    });

    assert.equal(res.status, 201, 'Expected HTTP 201 Created');
    const newUser = await res.json();

    assert.ok(newUser.id, 'User must have an ID');
    assert.equal(newUser.email, TEST_EMAIL);
    assert.equal(newUser.pass, undefined, 'Zero leakage: pass property must never be returned');
    registeredUserId = newUser.id;

    // Verify user can now log in with the custom password
    const loginRes = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD
      })
    });

    assert.equal(loginRes.status, 200, 'Expected successful login with new password');
    const loginData = await loginRes.json();
    assert.equal(loginData.user.id, newUser.id);
  });

  test('Scenario 6: Register Conflict on duplicate email (409 Conflict)', async () => {
    const duplicatePayload = {
      first_name: 'Duplicate',
      last_name: 'User',
      email: TEST_EMAIL,
      password: 'AnotherPassword123'
    };

    const res = await fetch(`http://localhost:${PORT}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(duplicatePayload)
    });

    assert.equal(res.status, 409, 'Expected HTTP 409 Conflict');
    const problem = await res.json();
    assert.equal(problem.status, 409);
    assert.ok(problem.detail.includes(TEST_EMAIL));
  });

  test('Scenario 7: Register Validation Failure with short password (422 ProblemDetails)', async () => {
    const shortPassPayload = {
      first_name: 'Short',
      last_name: 'Pass',
      email: 'shortpass@example.com',
      password: 'short' // < 8 chars
    };

    const res = await fetch(`http://localhost:${PORT}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shortPassPayload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 Unprocessable Entity');
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'password'));
  });

});
