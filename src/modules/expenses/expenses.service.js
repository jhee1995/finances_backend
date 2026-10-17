const expensesRepo = require('./expenses.repository');

// In-memory micro-cache for high-throughput resilience (2.5s TTL)
const expensesCache = new Map();
const CACHE_TTL_MS = 2500;

function invalidateCache() {
  expensesCache.clear();
}

class NotFoundError extends Error {
  constructor(message = 'Gasto no encontrado') {
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
 * Create a new expense with mandatory category validation and multitenant ownership
 * @param {{ user_id: number, category_id: number, amount: number, date: string }} data 
 */
async function createExpense(data) {
  const userExists = await expensesRepo.checkUserExists(data.user_id);
  if (!userExists) {
    throw new ValidationError('El usuario especificado no existe', [
      { name: 'user_id', reason: `El usuario con ID ${data.user_id} no existe en finances.users` }
    ]);
  }

  // Validate category existence and multitenant ownership
  const category = await expensesRepo.getCategoryById(data.category_id);
  if (!category) {
    throw new ValidationError('La categoría especificada no existe', [
      { name: 'category_id', reason: `La categoría con ID ${data.category_id} no existe en finances.categories` }
    ]);
  }

  const isAccessible = await expensesRepo.isCategoryAccessibleByUser(data.category_id, data.user_id);
  if (!isAccessible) {
    throw new ValidationError('La categoría especificada no pertenece al usuario', [
      { name: 'category_id', reason: 'La categoría seleccionada no pertenece al usuario titular ni a su núcleo familiar' }
    ]);
  }

  invalidateCache();
  const created = await expensesRepo.create(data);
  return {
    id: parseInt(created.id, 10),
    user_id: parseInt(created.user_id, 10),
    name: created.name || 'Gasto general',
    category_id: created.category_id ? parseInt(created.category_id, 10) : null,
    category_name: created.category_name || null,
    amount: parseFloat(created.amount),
    date: created.date,
    created_at: created.created_at
  };
}

/**
 * Get an expense by its ID with category metadata
 * @param {number} id 
 */
async function getExpenseById(id) {
  const expense = await expensesRepo.findById(id);
  if (!expense) {
    throw new NotFoundError(`No se encontró ningún gasto con ID ${id}`);
  }

  return {
    id: parseInt(expense.id, 10),
    user_id: parseInt(expense.user_id, 10),
    name: expense.name || 'Gasto general',
    category_id: expense.category_id ? parseInt(expense.category_id, 10) : null,
    category_name: expense.category_name || null,
    amount: parseFloat(expense.amount),
    date: expense.date,
    created_at: expense.created_at,
    updated_at: expense.updated_at || null
  };
}

/**
 * List expenses with optional filters (user_id, category_id, dates)
 * @param {{ user_id?: number, category_id?: number, start_date?: string, end_date?: string }} filters 
 */
async function listExpenses(filters = {}) {
  const cacheKey = JSON.stringify(filters);
  const cached = expensesCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const list = await expensesRepo.findAll(filters);
  const result = list.map(item => ({
    id: parseInt(item.id, 10),
    user_id: parseInt(item.user_id, 10),
    name: item.name || 'Gasto general',
    category_id: item.category_id ? parseInt(item.category_id, 10) : null,
    category_name: item.category_name || null,
    amount: parseFloat(item.amount),
    date: item.date,
    created_at: item.created_at,
    updated_at: item.updated_at || null
  }));
  expensesCache.set(cacheKey, { timestamp: now, data: result });
  return result;
}

/**
 * Update an existing expense
 * @param {number} id 
 * @param {{ user_id?: number, name?: string, category_id?: number, amount?: number, date?: string }} data 
 */
async function updateExpense(id, data) {
  const existing = await expensesRepo.findById(id);
  if (!existing) {
    throw new NotFoundError(`No se encontró ningún gasto con ID ${id}`);
  }

  const effectiveUserId = data.user_id !== undefined ? Number(data.user_id) : Number(existing.user_id);

  if (data.user_id !== undefined) {
    const userExists = await expensesRepo.checkUserExists(data.user_id);
    if (!userExists) {
      throw new ValidationError('El usuario especificado no existe', [
        { name: 'user_id', reason: `El usuario con ID ${data.user_id} no existe en finances.users` }
      ]);
    }
  }

  if (data.category_id !== undefined) {
    const category = await expensesRepo.getCategoryById(data.category_id);
    if (!category) {
      throw new ValidationError('La categoría especificada no existe', [
        { name: 'category_id', reason: `La categoría con ID ${data.category_id} no existe en finances.categories` }
      ]);
    }

    const isAccessible = await expensesRepo.isCategoryAccessibleByUser(data.category_id, effectiveUserId);
    if (!isAccessible) {
      throw new ValidationError('La categoría especificada no pertenece al usuario', [
        { name: 'category_id', reason: 'La categoría seleccionada no pertenece al usuario titular ni a su núcleo familiar' }
      ]);
    }
  }

  invalidateCache();
  const updated = await expensesRepo.update(id, data);
  return {
    id: parseInt(updated.id, 10),
    user_id: parseInt(updated.user_id, 10),
    name: updated.name || 'Gasto general',
    category_id: updated.category_id ? parseInt(updated.category_id, 10) : null,
    category_name: updated.category_name || null,
    amount: parseFloat(updated.amount),
    date: updated.date,
    created_at: updated.created_at,
    updated_at: updated.updated_at
  };
}

/**
 * Delete an expense by its ID
 * @param {number} id 
 */
async function deleteExpense(id) {
  const existing = await expensesRepo.findById(id);
  if (!existing) {
    throw new NotFoundError(`No se encontró ningún gasto con ID ${id}`);
  }

  invalidateCache();
  await expensesRepo.remove(id);
  return true;
}

module.exports = {
  createExpense,
  getExpenseById,
  listExpenses,
  updateExpense,
  deleteExpense,
  invalidateCache,
  NotFoundError,
  ValidationError
};
