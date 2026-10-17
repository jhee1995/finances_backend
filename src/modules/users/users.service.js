const usersRepo = require('./users.repository');

const userCache = new Map();
const CACHE_TTL_MS = 3000;

function getCachedUser(id) {
  const cached = userCache.get(Number(id));
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }
  return null;
}

function setCachedUser(id, data) {
  userCache.set(Number(id), { data, timestamp: Date.now() });
}

function invalidateUserCache(id) {
  if (id) {
    userCache.delete(Number(id));
  } else {
    userCache.clear();
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForbiddenError';
    this.status = 403;
  }
}

/**
 * Register a new user ensuring email uniqueness
 */
async function registerUser(userData) {
  const existing = await usersRepo.findByEmail(userData.email);
  if (existing) {
    throw new ConflictError(`El correo electrónico '${userData.email}' ya se encuentra registrado`);
  }

  const created = await usersRepo.create(userData);
  invalidateUserCache();
  return created;
}

/**
 * Get user by numerical ID with anti-IDOR check and volatile micro-cache
 */
async function getUserById(id, requesterId) {
  if (requesterId !== undefined && requesterId !== null) {
    if (Number(requesterId) !== Number(id)) {
      throw new ForbiddenError('Acceso no autorizado al perfil solicitado (Violación de aislamiento IDOR)');
    }
  }

  const cached = getCachedUser(id);
  if (cached) {
    return cached;
  }

  const user = await usersRepo.findById(id);
  if (!user) {
    throw new NotFoundError(`Usuario con ID ${id} no encontrado`);
  }

  setCachedUser(id, user);
  return user;
}

/**
 * List users with mandatory email filter (prevents mass user enumeration)
 */
async function listUsers(filters = {}, requesterId) {
  if (!filters.email || !filters.email.trim()) {
    throw new ForbiddenError('El listado indiscriminado de usuarios está restringido por políticas de privacidad y aislamiento');
  }

  return usersRepo.findAll(filters);
}

/**
 * Update user profile by ID with anti-IDOR check
 */
async function updateUser(id, updateData, requesterId) {
  if (requesterId !== undefined && requesterId !== null) {
    if (Number(requesterId) !== Number(id)) {
      throw new ForbiddenError('No tiene autorización para modificar el perfil de otro usuario');
    }
  }

  const existing = await usersRepo.findById(id);
  if (!existing) {
    throw new NotFoundError(`Usuario con ID ${id} no encontrado`);
  }

  const updated = await usersRepo.update(id, updateData);
  invalidateUserCache(id);
  return updated;
}

module.exports = {
  registerUser,
  getUserById,
  listUsers,
  updateUser,
  invalidateUserCache,
  ConflictError,
  NotFoundError,
  ForbiddenError
};
