const argon2 = require('argon2');
const crypto = require('crypto');

// Parameters defined strictly in decisions.yml and US-014:
// Memory: 64 MB (65,536 KiB)
// Iterations: 3
// Parallelism: 2
// Hash length: 32 bytes (256 bits)
// Salt size: 16 bytes (128 bits)
const ARGON2_CONFIG = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 2,
  hashLength: 32
};

const DEFAULT_SALT_HEX = '0346e1b6d49f9686b9ae25fe2128805b';
const DEFAULT_HASH = '$argon2id$v=19$m=65536,p=2,t=3$A0bhttSfloa5riX+ISiAWw$SR5LVuCuBLuhMLL1FP4wV1VeI1hQkNhXDg+PCljQ6XY';

/**
 * Hash a plain text password using Argon2id with strict parameters
 * @param {string} password 
 * @param {Buffer|string|null} customSalt 
 * @returns {Promise<string>}
 */
async function hashPassword(password, customSalt = null) {
  let salt;
  if (customSalt) {
    salt = Buffer.isBuffer(customSalt) ? customSalt : Buffer.from(customSalt, 'hex');
  } else {
    salt = crypto.randomBytes(16);
  }

  return argon2.hash(password, {
    ...ARGON2_CONFIG,
    salt
  });
}

/**
 * Verify a plain text password against an Argon2id hash
 * @param {string} hash 
 * @param {string} password 
 * @returns {Promise<boolean>}
 */
async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch (err) {
    console.error('Argon2 verification internal error:', err.message);
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  DEFAULT_SALT_HEX,
  DEFAULT_HASH,
  ARGON2_CONFIG
};
