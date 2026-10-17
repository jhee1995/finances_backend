const goalsService = require('./goals.service');
const {
  createGoalSchema,
  updateGoalSchema,
  getGoalsQuerySchema
} = require('./goals.schemas');

function extractUserIdFromAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [userId] = decoded.split(':');
    const id = Number(userId);
    return isNaN(id) ? null : id;
  } catch (err) {
    return null;
  }
}

function formatZodErrors(zodError) {
  return zodError.errors.map(err => ({
    name: err.path.join('.'),
    reason: err.message
  }));
}

function sendProblemDetails(res, status, title, detail, instance, invalidParams = null) {
  const errorTypes = {
    400: 'bad-request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not-found',
    409: 'conflict',
    422: 'validation-error',
    500: 'internal-server-error'
  };

  const problem = {
    type: `https://api.finances.com/errors/${errorTypes[status] || 'unknown-error'}`,
    title,
    status,
    detail,
    instance
  };

  if (invalidParams && invalidParams.length > 0) {
    problem.invalid_params = invalidParams;
  }

  return res.status(status).contentType('application/problem+json').json(problem);
}

/**
 * POST /api/goals (Contract: GOL-001)
 */
async function create(req, res) {
  try {
    const authUserId = extractUserIdFromAuth(req);
    const parseResult = createGoalSchema.safeParse(req.body);

    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación en la meta',
        'Los datos proporcionados para registrar la meta financiera no cumplen las restricciones.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const payload = parseResult.data;
    const actingUserId = authUserId || payload.userId || 1;

    const created = await goalsService.createGoal(payload, actingUserId);
    return res.status(201).json(created);
  } catch (err) {
    if (err.status === 422) {
      return sendProblemDetails(
        res,
        422,
        'Inconsistencia en la meta',
        err.message,
        req.originalUrl,
        err.invalid_params
      );
    }

    console.error('Error creating goal:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible registrar la meta financiera.',
      req.originalUrl
    );
  }
}

/**
 * GET /api/goals (Contract: GOL-002)
 */
async function list(req, res) {
  try {
    const authUserId = extractUserIdFromAuth(req);
    const parseResult = getGoalsQuerySchema.safeParse(req.query);

    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetros de consulta inválidos',
        'Los parámetros para listar las metas no son válidos.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const queryData = parseResult.data;
    const userId = queryData.userId || authUserId || 1;

    const summary = await goalsService.getGoals({
      userId,
      includeFamily: queryData.includeFamily
    });

    return res.status(200).json(summary);
  } catch (err) {
    console.error('Error listing goals:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible consultar las metas financieras.',
      req.originalUrl
    );
  }
}

/**
 * GET /api/goals/:id (Contract: GOL-003)
 */
async function getById(req, res) {
  try {
    const goalId = Number(req.params.id);
    if (isNaN(goalId) || goalId <= 0) {
      return sendProblemDetails(
        res,
        422,
        'Identificador inválido',
        'El ID de la meta debe ser un entero positivo.',
        req.originalUrl
      );
    }

    const authUserId = extractUserIdFromAuth(req) || 1;
    const goal = await goalsService.getGoalById(goalId, authUserId);
    return res.status(200).json(goal);
  } catch (err) {
    if (err.status === 404) {
      return sendProblemDetails(
        res,
        404,
        'Meta no encontrada',
        err.message,
        req.originalUrl
      );
    }

    console.error('Error getting goal by id:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible consultar la meta.',
      req.originalUrl
    );
  }
}

/**
 * PUT /api/goals/:id (Contract: GOL-004)
 */
async function update(req, res) {
  try {
    const goalId = Number(req.params.id);
    if (isNaN(goalId) || goalId <= 0) {
      return sendProblemDetails(
        res,
        422,
        'Identificador inválido',
        'El ID de la meta debe ser un entero positivo.',
        req.originalUrl
      );
    }

    const parseResult = updateGoalSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación al actualizar meta',
        'Uno o más datos enviados no son válidos.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const authUserId = extractUserIdFromAuth(req) || 1;
    const updated = await goalsService.updateGoal(goalId, parseResult.data, authUserId);
    return res.status(200).json(updated);
  } catch (err) {
    if (err.status === 404) {
      return sendProblemDetails(res, 404, 'Meta no encontrada', err.message, req.originalUrl);
    }
    if (err.status === 422) {
      return sendProblemDetails(res, 422, 'Inconsistencia en los datos', err.message, req.originalUrl, err.invalid_params);
    }

    console.error('Error updating goal:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible actualizar la meta financiera.',
      req.originalUrl
    );
  }
}

/**
 * DELETE /api/goals/:id (Contract: GOL-005)
 */
async function remove(req, res) {
  try {
    const goalId = Number(req.params.id);
    if (isNaN(goalId) || goalId <= 0) {
      return sendProblemDetails(
        res,
        422,
        'Identificador inválido',
        'El ID de la meta debe ser un entero positivo.',
        req.originalUrl
      );
    }

    const authUserId = extractUserIdFromAuth(req) || 1;
    await goalsService.deleteGoal(goalId, authUserId);
    return res.status(204).send();
  } catch (err) {
    if (err.status === 404) {
      return sendProblemDetails(res, 404, 'Meta no encontrada', err.message, req.originalUrl);
    }

    console.error('Error deleting goal:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible eliminar la meta financiera.',
      req.originalUrl
    );
  }
}

module.exports = {
  create,
  list,
  getById,
  update,
  remove
};
