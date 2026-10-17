const incomesService = require('./incomes.service');
const {
  createIncomeSchema,
  updateIncomeSchema,
  incomeIdParamSchema,
  getIncomesQuerySchema
} = require('./incomes.schemas');

function formatZodErrors(zodError) {
  return zodError.errors.map(err => ({
    name: err.path.join('.'),
    reason: err.message
  }));
}

/**
 * Handle POST /api/incomes (Contract: INC-001)
 */
async function create(req, res) {
  try {
    const parseResult = createIncomeSchema.safeParse(req.body);
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

    const created = await incomesService.createIncome(parseResult.data);
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

    console.error('Error creating income:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible registrar el ingreso en la base de datos',
      instance: req.originalUrl
    });
  }
}

/**
 * Handle GET /api/incomes (Contract: INC-002)
 */
async function list(req, res) {
  try {
    const queryResult = getIncomesQuerySchema.safeParse(req.query);
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

    const incomes = await incomesService.listIncomes(queryResult.data);
    return res.status(200).json(incomes);
  } catch (err) {
    console.error('Error listing incomes:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible consultar los ingresos',
      instance: req.originalUrl
    });
  }
}

/**
 * Handle GET /api/incomes/:id (Contract: INC-003)
 */
async function getById(req, res) {
  try {
    const paramResult = incomeIdParamSchema.safeParse(req.params);
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

    const income = await incomesService.getIncomeById(paramResult.data.id);
    return res.status(200).json(income);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return res.status(404).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/not-found',
        title: 'Ingreso no encontrado',
        status: 404,
        detail: err.message,
        instance: req.originalUrl
      });
    }

    console.error('Error getting income by ID:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible consultar el ingreso',
      instance: req.originalUrl
    });
  }
}

/**
 * Handle PUT /api/incomes/:id (Contract: INC-004)
 */
async function update(req, res) {
  try {
    const paramResult = incomeIdParamSchema.safeParse(req.params);
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

    const bodyResult = updateIncomeSchema.safeParse(req.body);
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

    const updated = await incomesService.updateIncome(paramResult.data.id, bodyResult.data);
    return res.status(200).json(updated);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return res.status(404).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/not-found',
        title: 'Ingreso no encontrado para actualizar',
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

    console.error('Error updating income:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible actualizar el ingreso',
      instance: req.originalUrl
    });
  }
}

/**
 * Handle DELETE /api/incomes/:id (Contract: INC-005)
 */
async function remove(req, res) {
  try {
    const paramResult = incomeIdParamSchema.safeParse(req.params);
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

    await incomesService.deleteIncome(paramResult.data.id);
    return res.status(204).send();
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return res.status(404).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/not-found',
        title: 'Ingreso no encontrado para eliminar',
        status: 404,
        detail: err.message,
        instance: req.originalUrl
      });
    }

    console.error('Error deleting income:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible eliminar el ingreso',
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
