const incomesRepo = require('./incomes.repository');

class NotFoundError extends Error {
  constructor(message = 'Ingreso no encontrado') {
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
 * Create a new income
 * @param {{ user_id: number, income_amount: number, date: string }} data 
 */
async function createIncome(data) {
  const userExists = await incomesRepo.checkUserExists(data.user_id);
  if (!userExists) {
    throw new ValidationError('El usuario especificado no existe', [
      { name: 'user_id', reason: `El usuario con ID ${data.user_id} no existe en finances.users` }
    ]);
  }

  const created = await incomesRepo.create(data);
  return {
    id: parseInt(created.id, 10),
    user_id: parseInt(created.user_id, 10),
    name: created.name || 'Ingreso registrado',
    income_amount: parseFloat(created.income_amount),
    date: created.date,
    created_at: created.created_at
  };
}

/**
 * Get an income by its ID
 * @param {number} id 
 */
async function getIncomeById(id) {
  const income = await incomesRepo.findById(id);
  if (!income) {
    throw new NotFoundError(`No se encontró ningún ingreso con ID ${id}`);
  }

  return {
    id: parseInt(income.id, 10),
    user_id: parseInt(income.user_id, 10),
    name: income.name || 'Ingreso registrado',
    income_amount: parseFloat(income.income_amount),
    date: income.date,
    created_at: income.created_at,
    updated_at: income.updated_at || null
  };
}

/**
 * List incomes with optional filters
 * @param {{ user_id?: number, start_date?: string, end_date?: string }} filters 
 */
async function listIncomes(filters = {}) {
  const list = await incomesRepo.findAll(filters);
  return list.map(item => ({
    id: parseInt(item.id, 10),
    user_id: parseInt(item.user_id, 10),
    name: item.name || 'Ingreso registrado',
    income_amount: parseFloat(item.income_amount),
    date: item.date,
    created_at: item.created_at,
    updated_at: item.updated_at || null
  }));
}

/**
 * Update an existing income
 * @param {number} id 
 * @param {{ user_id?: number, name?: string, income_amount?: number, date?: string }} data 
 */
async function updateIncome(id, data) {
  const existing = await incomesRepo.findById(id);
  if (!existing) {
    throw new NotFoundError(`No se encontró ningún ingreso con ID ${id}`);
  }

  if (data.user_id !== undefined) {
    const userExists = await incomesRepo.checkUserExists(data.user_id);
    if (!userExists) {
      throw new ValidationError('El usuario especificado no existe', [
        { name: 'user_id', reason: `El usuario con ID ${data.user_id} no existe en finances.users` }
      ]);
    }
  }

  const updated = await incomesRepo.update(id, data);
  return {
    id: parseInt(updated.id, 10),
    user_id: parseInt(updated.user_id, 10),
    name: updated.name || 'Ingreso registrado',
    income_amount: parseFloat(updated.income_amount),
    date: updated.date,
    created_at: updated.created_at,
    updated_at: updated.updated_at
  };
}

/**
 * Delete an income by its ID
 * @param {number} id 
 */
async function deleteIncome(id) {
  const existing = await incomesRepo.findById(id);
  if (!existing) {
    throw new NotFoundError(`No se encontró ningún ingreso con ID ${id}`);
  }

  await incomesRepo.remove(id);
  return true;
}

module.exports = {
  createIncome,
  getIncomeById,
  listIncomes,
  updateIncome,
  deleteIncome,
  NotFoundError,
  ValidationError
};
