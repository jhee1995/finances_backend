const usersRepo = require('../users/users.repository');
const { hashPassword, verifyPassword } = require('./auth.crypto');

class AuthenticationError extends Error {
  constructor(message = 'Credenciales inválidas') {
    super(message);
    this.name = 'AuthenticationError';
    this.status = 401;
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
  }
}

/**
 * Authenticate user with email and password
 * @param {string} email 
 * @param {string} password 
 */
async function authenticate(email, password) {
  const user = await usersRepo.findByEmailWithPassword(email);

  if (!user || !user.pass) {
    // Return generic error to avoid user enumeration
    throw new AuthenticationError('Credenciales inválidas');
  }

  const isValid = await verifyPassword(user.pass, password);
  if (!isValid) {
    throw new AuthenticationError('Credenciales inválidas');
  }

  // Token generator (mock JWT/session token for MVP)
  const token = Buffer.from(`${user.id}:${Date.now()}:${user.email}`).toString('base64');

  return {
    message: 'Autenticación exitosa',
    token,
    user: {
      id: parseInt(user.id, 10),
      first_name: user.first_name,
      middle_name: user.middle_name,
      last_name: user.last_name,
      email: user.email,
      family_core: user.family_core ? parseInt(user.family_core, 10) : null
    }
  };
}

/**
 * Register new user with hashed password
 * @param {{ first_name: string, middle_name?: string|null, last_name: string, email: string, password?: string, family_core?: number|null }} userData 
 */
async function register(userData) {
  const existing = await usersRepo.findByEmail(userData.email);
  if (existing) {
    throw new ConflictError(`El correo electrónico '${userData.email}' ya se encuentra registrado`);
  }

  let passHash;
  if (userData.password) {
    passHash = await hashPassword(userData.password);
  }

  const created = await usersRepo.create({
    first_name: userData.first_name,
    middle_name: userData.middle_name,
    last_name: userData.last_name,
    email: userData.email,
    family_core: userData.family_core,
    pass: passHash // If undefined, repository uses DB default
  });

  return {
    id: parseInt(created.id, 10),
    first_name: created.first_name,
    middle_name: created.middle_name,
    last_name: created.last_name,
    email: created.email,
    family_core: created.family_core ? parseInt(created.family_core, 10) : null,
    created_at: created.created_at
  };
}

module.exports = {
  authenticate,
  register,
  AuthenticationError,
  ConflictError
};
