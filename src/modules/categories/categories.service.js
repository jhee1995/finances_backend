const db = require('../../shared/database/db');
const categoriesRepo = require('./categories.repository');

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

class ValidationError extends Error {
  constructor(message = 'Error de validación', invalidParams = []) {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
    this.invalid_params = invalidParams;
  }
}

/**
 * Register a new category ensuring name uniqueness and auto-linking family core
 * @param {{ name: string, percentage: number, user_id?: number, family_id?: number|null }} categoryData
 */
async function registerCategory(categoryData) {
  if (categoryData.user_id && !categoryData.family_id) {
    const userRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [categoryData.user_id]);
    if (userRes.rows[0]?.family_core) {
      categoryData.family_id = Number(userRes.rows[0].family_core);
    }
  }

  const existing = await categoriesRepo.findByName(categoryData.name, categoryData.user_id || null);
  if (existing) {
    throw new ConflictError(`La categoría con nombre '${categoryData.name}' ya se encuentra registrada`);
  }

  return categoriesRepo.create(categoryData);
}

/**
 * Get category by numerical ID
 * @param {number} id
 */
async function getCategoryById(id) {
  const category = await categoriesRepo.findById(id);
  if (!category) {
    throw new NotFoundError(`Categoría con ID ${id} no encontrada`);
  }
  return category;
}

/**
 * List all categories, optionally filtered by user_id
 * @param {number|null} userId
 */
async function listCategories(userId = null) {
  return categoriesRepo.findAll(userId);
}

/**
 * Update an existing category with co-ownership authorization
 * @param {number} id
 * @param {{ name?: string, percentage?: number, user_id?: number, family_id?: number|null }} categoryData
 */
async function updateCategory(id, categoryData) {
  const existing = await categoriesRepo.findById(id);
  if (!existing) {
    throw new NotFoundError(`Categoría con ID ${id} no encontrada`);
  }

  // Cross-tenant permission check if user_id is provided
  if (categoryData.user_id) {
    const actingUserId = Number(categoryData.user_id);
    const ownerUserId = existing.user_id ? Number(existing.user_id) : null;
    const catFamilyId = existing.family_id ? Number(existing.family_id) : null;

    let authorized = false;
    if (ownerUserId && ownerUserId === actingUserId) {
      authorized = true;
    } else {
      const userRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [actingUserId]);
      const actingFamilyCore = userRes.rows[0]?.family_core ? Number(userRes.rows[0].family_core) : null;

      if (actingFamilyCore) {
        if (catFamilyId && catFamilyId === actingFamilyCore) {
          authorized = true;
        } else if (ownerUserId) {
          const ownerRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [ownerUserId]);
          const ownerFamilyCore = ownerRes.rows[0]?.family_core ? Number(ownerRes.rows[0].family_core) : null;
          if (ownerFamilyCore && ownerFamilyCore === actingFamilyCore) {
            authorized = true;
          }
        }
      }
    }

    if (!authorized) {
      throw new ValidationError('No tiene permisos para modificar esta categoría', [
        { name: 'user_id', reason: 'El usuario no es titular ni miembro del núcleo familiar propietario de la categoría' }
      ]);
    }
  }

  if (categoryData.name && categoryData.name.toLowerCase().trim() !== existing.name.toLowerCase().trim()) {
    const duplicate = await categoriesRepo.findByName(categoryData.name, categoryData.user_id || existing.user_id || null);
    if (duplicate && duplicate.id !== id) {
      throw new ConflictError(`Ya existe otra categoría con el nombre '${categoryData.name}'`);
    }
  }

  return categoriesRepo.update(id, categoryData);
}

/**
 * Delete a category with co-ownership authorization
 * @param {number} id
 * @param {number|null} userId
 */
async function deleteCategory(id, userId = null) {
  const existing = await categoriesRepo.findById(id);
  if (!existing) {
    throw new NotFoundError(`Categoría con ID ${id} no encontrada`);
  }

  if (userId) {
    const actingUserId = Number(userId);
    const ownerUserId = existing.user_id ? Number(existing.user_id) : null;
    const catFamilyId = existing.family_id ? Number(existing.family_id) : null;

    let authorized = false;
    if (ownerUserId && ownerUserId === actingUserId) {
      authorized = true;
    } else {
      const userRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [actingUserId]);
      const actingFamilyCore = userRes.rows[0]?.family_core ? Number(userRes.rows[0].family_core) : null;

      if (actingFamilyCore) {
        if (catFamilyId && catFamilyId === actingFamilyCore) {
          authorized = true;
        } else if (ownerUserId) {
          const ownerRes = await db.query('SELECT family_core FROM finances.users WHERE id = $1', [ownerUserId]);
          const ownerFamilyCore = ownerRes.rows[0]?.family_core ? Number(ownerRes.rows[0].family_core) : null;
          if (ownerFamilyCore && ownerFamilyCore === actingFamilyCore) {
            authorized = true;
          }
        }
      }
    }

    if (!authorized) {
      throw new ValidationError('No tiene permisos para eliminar esta categoría', [
        { name: 'user_id', reason: 'El usuario no es titular ni miembro del núcleo familiar propietario de la categoría' }
      ]);
    }
  }

  return categoriesRepo.remove(id);
}

module.exports = {
  registerCategory,
  getCategoryById,
  listCategories,
  updateCategory,
  deleteCategory,
  ConflictError,
  NotFoundError,
  ValidationError
};
