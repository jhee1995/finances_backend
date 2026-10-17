const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3096;
const TEST_SUFFIX = Date.now().toString().slice(-6);
const CATEGORY_NAME_1 = `Cat_${TEST_SUFFIX}`;
const CATEGORY_NAME_2 = `Cat2_${TEST_SUFFIX}`;
let createdCategoryId = null;

before(async () => {
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });
});

after(async () => {
  // Cleanup test categories from finances.categories if created
  if (createdCategoryId) {
    await db.query('DELETE FROM finances.categories WHERE id = $1;', [createdCategoryId]);
  }
  await db.query('DELETE FROM finances.categories WHERE name LIKE $1;', [`Cat%_${TEST_SUFFIX}`]);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
});

describe('US-003 Integration Test Suite: Categories Management (finances.categories)', () => {

  test('Scenario 1: Happy Path - POST /api/categories creates category (201 Created)', async () => {
    const payload = {
      name: CATEGORY_NAME_1,
      percentage: 25
    };

    const res = await fetch(`http://localhost:${PORT}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201, 'Expected HTTP 201 Created');
    const category = await res.json();

    assert.ok(category.id, 'Category must have an auto-generated ID');
    assert.equal(category.name, CATEGORY_NAME_1);
    assert.equal(category.percentage, 25);

    createdCategoryId = category.id;
  });

  test('Scenario 2: Validation Failure - POST /api/categories returns 422 for invalid inputs', async () => {
    const invalidPayload = {
      name: 'ThisCategoryNameIsWayTooLongForDatabaseLimit', // > 20 chars
      percentage: 150 // > 100
    };

    const res = await fetch(`http://localhost:${PORT}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload)
    });

    assert.equal(res.status, 422, 'Expected HTTP 422 Unprocessable Entity');
    const problem = await res.json();

    assert.equal(problem.status, 422);
    assert.ok(Array.isArray(problem.invalid_params));
    assert.ok(problem.invalid_params.some(p => p.name === 'name'));
    assert.ok(problem.invalid_params.some(p => p.name === 'percentage'));
  });

  test('Scenario 3: Conflict - POST /api/categories returns 409 for duplicate category name', async () => {
    const duplicatePayload = {
      name: CATEGORY_NAME_1.toLowerCase(), // case-insensitive duplicate check
      percentage: 10
    };

    const res = await fetch(`http://localhost:${PORT}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(duplicatePayload)
    });

    assert.equal(res.status, 409, 'Expected HTTP 409 Conflict');
    const problem = await res.json();
    assert.equal(problem.status, 409);
    assert.ok(problem.detail.includes(CATEGORY_NAME_1.toLowerCase()));
  });

  test('Scenario 4: Happy Path Query - GET /api/categories lists registered categories (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/categories`);
    assert.equal(res.status, 200, 'Expected HTTP 200 OK');

    const categories = await res.json();
    assert.ok(Array.isArray(categories));
    assert.ok(categories.length >= 1);
    const found = categories.find(c => c.id === createdCategoryId);
    assert.ok(found, 'Created category should appear in the list');
    assert.equal(found.name, CATEGORY_NAME_1);
  });

  test('Scenario 5: Happy Path Get by ID - GET /api/categories/:id returns specific category (200 OK)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/categories/${createdCategoryId}`);
    assert.equal(res.status, 200, 'Expected HTTP 200 OK');

    const category = await res.json();
    assert.equal(category.id, createdCategoryId);
    assert.equal(category.name, CATEGORY_NAME_1);
    assert.equal(category.percentage, 25);
  });

  test('Scenario 6: Not Found / Validation - GET /api/categories/:id edge cases', async () => {
    // Non-existent ID -> 404
    const notFoundRes = await fetch(`http://localhost:${PORT}/api/categories/99999999`);
    assert.equal(notFoundRes.status, 404, 'Expected HTTP 404 Not Found');

    // Non-numeric ID -> 422
    const invalidIdRes = await fetch(`http://localhost:${PORT}/api/categories/invalid-id`);
    assert.equal(invalidIdRes.status, 422, 'Expected HTTP 422 Unprocessable Entity');
  });

  test('Scenario 7: Happy Path Update - PUT /api/categories/:id modifies percentage and name (200 OK)', async () => {
    const updatePayload = {
      name: CATEGORY_NAME_2,
      percentage: 35
    };

    const res = await fetch(`http://localhost:${PORT}/api/categories/${createdCategoryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });

    assert.equal(res.status, 200, 'Expected HTTP 200 OK');
    const updated = await res.json();
    assert.equal(updated.id, createdCategoryId);
    assert.equal(updated.name, CATEGORY_NAME_2);
    assert.equal(updated.percentage, 35);
  });

  test('Scenario 8: PUT /api/categories/:id error cases (404 not found, 422 validation, 409 conflict)', async () => {
    // Non-existent ID -> 404
    const notFoundRes = await fetch(`http://localhost:${PORT}/api/categories/99999999`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ValidName' })
    });
    assert.equal(notFoundRes.status, 404);

    // Non-numeric ID -> 422
    const invalidIdRes = await fetch(`http://localhost:${PORT}/api/categories/not-a-number`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ValidName' })
    });
    assert.equal(invalidIdRes.status, 422);

    // Empty body -> 422
    const emptyBodyRes = await fetch(`http://localhost:${PORT}/api/categories/${createdCategoryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(emptyBodyRes.status, 422);
  });

  test('Scenario 9: DELETE /api/categories/:id error cases (404, 422)', async () => {
    const notFoundRes = await fetch(`http://localhost:${PORT}/api/categories/99999999`, {
      method: 'DELETE'
    });
    assert.equal(notFoundRes.status, 404);

    const invalidIdRes = await fetch(`http://localhost:${PORT}/api/categories/not-a-number`, {
      method: 'DELETE'
    });
    assert.equal(invalidIdRes.status, 422);
  });

  test('Scenario 10: Delete Category - DELETE /api/categories/:id removes category (204 No Content)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/categories/${createdCategoryId}`, {
      method: 'DELETE'
    });

    assert.equal(res.status, 204, 'Expected HTTP 204 No Content');

    // Verify it is gone
    const getRes = await fetch(`http://localhost:${PORT}/api/categories/${createdCategoryId}`);
    assert.equal(getRes.status, 404, 'Category should no longer exist');
    createdCategoryId = null; // Mark as deleted so after hook doesn't error
  });

});
