const expensesService = require('./expenses.service');
const {
  createExpenseSchema,
  updateExpenseSchema,
  expenseIdParamSchema,
  getExpensesQuerySchema
} = require('./expenses.schemas');

function formatZodErrors(zodError) {
  return zodError.errors.map(err => ({
    name: err.path.join('.'),
    reason: err.message
  }));
}

/**
 * Handle POST /api/expenses (Contract: EXP-001)
 */
async function create(req, res) {
  try {
    const parseResult = createExpenseSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(422).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación en los parámetros de entrada',
        status: 422,
        detail: 'Los datos proporcionados no cumplen con el esquema requerido',
        instance: req.originalUrl,
        invalid_params: formatZodErrors(parseResult.error)
      });
    }

    const created = await expensesService.createExpense(parseResult.data);
    return res.status(201).json(created);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(422).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación de entidad',
        status: 422,
        detail: err.message,
        instance: req.originalUrl,
        invalid_params: err.invalid_params || []
      });
    }

    console.error('Error creating expense:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible registrar el gasto en la base de datos',
      instance: req.originalUrl
    });
  }
}

/**
 * Handle GET /api/expenses (Contract: EXP-002)
 */
async function list(req, res) {
  try {
    const queryResult = getExpensesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(422).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación en parámetros de consulta',
        status: 422,
        detail: 'Los parámetros de filtro son inválidos',
        instance: req.originalUrl,
        invalid_params: formatZodErrors(queryResult.error)
      });
    }

    const expenses = await expensesService.listExpenses(queryResult.data);
    return res.status(200).json(expenses);
  } catch (err) {
    console.error('Error listing expenses:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible consultar los gastos',
      instance: req.originalUrl
    });
  }
}

/**
 * Handle GET /api/expenses/:id (Contract: EXP-003)
 */
async function getById(req, res) {
  try {
    const paramResult = expenseIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(422).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación en parámetro de ruta',
        status: 422,
        detail: 'El ID proporcionado es inválido',
        instance: req.originalUrl,
        invalid_params: formatZodErrors(paramResult.error)
      });
    }

    const expense = await expensesService.getExpenseById(paramResult.data.id);
    return res.status(200).json(expense);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return res.status(404).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/not-found',
        title: 'Gasto no encontrado',
        status: 404,
        detail: err.message,
        instance: req.originalUrl
      });
    }

    console.error('Error getting expense by ID:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible consultar el gasto',
      instance: req.originalUrl
    });
  }
}

/**
 * Handle PUT /api/expenses/:id (Contract: EXP-004)
 */
async function update(req, res) {
  try {
    const paramResult = expenseIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(422).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación en parámetro de ruta',
        status: 422,
        detail: 'El ID proporcionado es inválido',
        instance: req.originalUrl,
        invalid_params: formatZodErrors(paramResult.error)
      });
    }

    const bodyResult = updateExpenseSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(422).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación en el cuerpo de actualización',
        status: 422,
        detail: 'Los datos proporcionados para actualizar son inválidos o están vacíos',
        instance: req.originalUrl,
        invalid_params: formatZodErrors(bodyResult.error)
      });
    }

    const updated = await expensesService.updateExpense(paramResult.data.id, bodyResult.data);
    return res.status(200).json(updated);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return res.status(404).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/not-found',
        title: 'Gasto no encontrado para actualizar',
        status: 404,
        detail: err.message,
        instance: req.originalUrl
      });
    }

    if (err.name === 'ValidationError') {
      return res.status(422).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación de entidad',
        status: 422,
        detail: err.message,
        instance: req.originalUrl,
        invalid_params: err.invalid_params || []
      });
    }

    console.error('Error updating expense:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible actualizar el gasto',
      instance: req.originalUrl
    });
  }
}

/**
 * Handle DELETE /api/expenses/:id (Contract: EXP-005)
 */
async function remove(req, res) {
  try {
    const paramResult = expenseIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(422).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación en parámetro de ruta',
        status: 422,
        detail: 'El ID proporcionado es inválido',
        instance: req.originalUrl,
        invalid_params: formatZodErrors(paramResult.error)
      });
    }

    await expensesService.deleteExpense(paramResult.data.id);
    return res.status(204).send();
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return res.status(404).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/not-found',
        title: 'Gasto no encontrado para eliminar',
        status: 404,
        detail: err.message,
        instance: req.originalUrl
      });
    }

    console.error('Error deleting expense:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible eliminar el gasto',
      instance: req.originalUrl
    });
  }
}

module.exports = {
  create,
  list,
  getById,
  update,
  remove
};
