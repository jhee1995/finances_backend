const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  hashPassword,
  verifyPassword,
  DEFAULT_SALT_HEX,
  DEFAULT_HASH,
  ARGON2_CONFIG
} = require('../../src/modules/auth/auth.crypto');

describe('US-014 Unit Test Suite: Argon2id Cryptographic Verification', () => {

  test('Argon2id configuration parameters match strict specification', () => {
    assert.equal(ARGON2_CONFIG.memoryCost, 65536, 'Memory cost must be 64 MB (65536 KiB)');
    assert.equal(ARGON2_CONFIG.timeCost, 3, 'Iterations must be 3');
    assert.equal(ARGON2_CONFIG.parallelism, 2, 'Parallelism must be 2');
    assert.equal(ARGON2_CONFIG.hashLength, 32, 'Hash length must be 32 bytes (256 bits)');
    assert.equal(DEFAULT_SALT_HEX, '0346e1b6d49f9686b9ae25fe2128805b', 'Salt hex vector must match exact 16-byte specification');
  });

  test('Default hash verifies correctly with default password (pass123)', async () => {
    const isValid = await verifyPassword(DEFAULT_HASH, 'pass123');
    assert.equal(isValid, true, 'Default hash must verify true for pass123');
  });

  test('Default hash rejects incorrect password', async () => {
    const isValid = await verifyPassword(DEFAULT_HASH, 'WrongPassword999');
    assert.equal(isValid, false, 'Default hash must reject incorrect password');
  });

  test('hashPassword produces valid Argon2id PHC string with custom salt', async () => {
    const hash = await hashPassword('pass123', DEFAULT_SALT_HEX);
    assert.ok(hash.startsWith('$argon2id$v=19$m=65536,p=2,t=3$'), 'Hash must have standard Argon2id PHC prefix with m=65536,p=2,t=3');
    const isValid = await verifyPassword(hash, 'pass123');
    assert.equal(isValid, true, 'Custom salted hash must verify true for original password');
  });

  test('hashPassword produces unique valid Argon2id hash with CSPRNG salt', async () => {
    const hash1 = await hashPassword('SecretKey123!');
    const hash2 = await hashPassword('SecretKey123!');
    assert.notEqual(hash1, hash2, 'Two hashes of the same password must differ due to CSPRNG salt');
    assert.equal(await verifyPassword(hash1, 'SecretKey123!'), true);
    assert.equal(await verifyPassword(hash2, 'SecretKey123!'), true);
  });

  test('verifyPassword handles corrupted hash gracefully without crashing', async () => {
    const isValid = await verifyPassword('not-a-valid-argon2-hash', 'anyPassword');
    assert.equal(isValid, false, 'Corrupted hash must return false without uncaught exception');
  });

});
