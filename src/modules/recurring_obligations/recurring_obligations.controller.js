const {
  createRecurringObligationSchema,
  payRecurringObligationSchema,
  periodStatusQuerySchema
} = require('./recurring_obligations.schemas');
const service = require('./recurring_obligations.service');

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

function sendProblemDetails(res, status, title, detail, instance, invalidParams = []) {
  res.status(status).contentType('application/problem+json').json({
    type: `https://api.finances.com/errors/${status}`,
    title,
    status,
    detail,
    instance,
    ...(invalidParams.length > 0 ? { invalid_params: invalidParams } : {})
  });
}

/**
 * POST /api/recurring-obligations (REC-001)
 */
async function create(req, res) {
  const authUserId = extractUserIdFromAuth(req) || Number(req.body.user_id) || 1;

  const validation = createRecurringObligationSchema.safeParse(req.body || {});
  if (!validation.success) {
    const invalidParams = validation.error.errors.map(err => ({
      name: err.path.join('.'),
      reason: err.message
    }));
    return sendProblemDetails(
      res,
      422,
      'Error de validación',
      'Uno o más campos del cuerpo de la petición contienen valores fuera de rango',
      req.originalUrl,
      invalidParams
    );
  }

  try {
    const result = await service.createObligation(validation.data, authUserId);
    return res.status(201).json(result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return sendProblemDetails(res, 422, 'Error de validación', err.message, req.originalUrl, err.invalid_params);
    }
    console.error('Error creating recurring obligation:', err);
    return sendProblemDetails(res, 500, 'Error interno', 'No fue posible registrar la obligación periódica', req.originalUrl);
  }
}

/**
 * GET /api/recurring-obligations (REC-002)
 */
async function list(req, res) {
  const authUserId = extractUserIdFromAuth(req) || Number(req.query.user_id) || 1;
  const includeFamily = req.query.include_family === 'true' || req.query.include_family === true;
  const status = req.query.status || 'ACTIVE';

  try {
    const results = await service.listObligations({
      userId: authUserId,
      includeFamily,
      status
    });
    return res.status(200).json(results);
  } catch (err) {
    console.error('Error listing recurring obligations:', err);
    return sendProblemDetails(res, 500, 'Error interno', 'No fue posible consultar las obligaciones periódicas', req.originalUrl);
  }
}

/**
 * GET /api/recurring-obligations/period-status (REC-003)
 */
async function getPeriodStatus(req, res) {
  const authUserId = extractUserIdFromAuth(req) || Number(req.query.user_id) || 1;

  const validation = periodStatusQuerySchema.safeParse(req.query || {});
  if (!validation.success) {
    const invalidParams = validation.error.errors.map(err => ({
      name: err.path.join('.'),
      reason: err.message
    }));
    return sendProblemDetails(
      res,
      422,
      'Parámetros de consulta inválidos',
      'Uno o más parámetros de búsqueda son incorrectos',
      req.originalUrl,
      invalidParams
    );
  }

  try {
    const result = await service.getPeriodStatus({
      userId: authUserId,
      year: validation.data.year,
      month: validation.data.month,
      cycle: validation.data.cycle,
      includeFamily: validation.data.include_family
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error getting period status:', err);
    return sendProblemDetails(res, 500, 'Error interno', 'No fue posible consultar el estado del ciclo', req.originalUrl);
  }
}

/**
 * POST /api/recurring-obligations/:id/pay (REC-004)
 */
async function pay(req, res) {
  const authUserId = extractUserIdFromAuth(req) || Number(req.body.user_id) || 1;
  const obligationId = Number(req.params.id);

  if (isNaN(obligationId) || obligationId <= 0) {
    return sendProblemDetails(res, 422, 'Parámetro inválido', 'El ID de la obligación debe ser un entero positivo', req.originalUrl);
  }

  const validation = payRecurringObligationSchema.safeParse(req.body || {});
  if (!validation.success) {
    const invalidParams = validation.error.errors.map(err => ({
      name: err.path.join('.'),
      reason: err.message
    }));
    return sendProblemDetails(
      res,
      422,
      'Error de validación',
      'Uno o más campos del pago contienen valores fuera de rango',
      req.originalUrl,
      invalidParams
    );
  }

  try {
    const result = await service.payObligation(obligationId, validation.data, authUserId);
    return res.status(201).json(result);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return sendProblemDetails(res, 404, 'No encontrado', err.message, req.originalUrl);
    }
    if (err.name === 'ForbiddenError') {
      return sendProblemDetails(res, 403, 'Acceso denegado', err.message, req.originalUrl);
    }
    if (err.name === 'ConflictError') {
      return sendProblemDetails(res, 409, 'Conflicto de estado', err.message, req.originalUrl);
    }
    if (err.name === 'ValidationError') {
      return sendProblemDetails(res, 422, 'Error de validación', err.message, req.originalUrl, err.invalid_params);
    }
    console.error('Error paying recurring obligation:', err);
    return sendProblemDetails(res, 500, 'Error interno', 'No fue posible registrar el pago de la obligación', req.originalUrl);
  }
}

/**
 * DELETE /api/recurring-obligations/:id (REC-005)
 */
async function remove(req, res) {
  const authUserId = extractUserIdFromAuth(req) || 1;
  const obligationId = Number(req.params.id);

  if (isNaN(obligationId) || obligationId <= 0) {
    return sendProblemDetails(res, 422, 'Parámetro inválido', 'El ID de la obligación debe ser un entero positivo', req.originalUrl);
  }

  try {
    await service.removeObligation(obligationId, authUserId);
    return res.status(204).send();
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return sendProblemDetails(res, 404, 'No encontrado', err.message, req.originalUrl);
    }
    if (err.name === 'ForbiddenError') {
      return sendProblemDetails(res, 403, 'Acceso denegado', err.message, req.originalUrl);
    }
    console.error('Error removing recurring obligation:', err);
    return sendProblemDetails(res, 500, 'Error interno', 'No fue posible eliminar la obligación periódica', req.originalUrl);
  }
}

module.exports = {
  create,
  list,
  getPeriodStatus,
  pay,
  remove
};
