const { comparePlansSchema, savePlanSchema } = require('./payment_plans.schemas');
const paymentPlansService = require('./payment_plans.service');

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
 * POST /api/payment-plans/compare (PLN-001)
 */
async function comparePlans(req, res) {
  const userId = extractUserIdFromAuth(req);
  if (!userId) {
    return sendProblemDetails(
      res,
      401,
      'No autorizado',
      'Debe proporcionar un token de autenticación Bearer válido para comparar planes de pago',
      req.originalUrl
    );
  }

  const validation = comparePlansSchema.safeParse(req.body || {});
  if (!validation.success) {
    const invalidParams = validation.error.errors.map(err => ({
      name: err.path.join('.'),
      reason: err.message
    }));
    return sendProblemDetails(
      res,
      422,
      'Parámetros de comparación inválidos',
      'Uno o más campos del cuerpo de la petición contienen valores fuera de rango',
      req.originalUrl,
      invalidParams
    );
  }

  try {
    const result = await paymentPlansService.comparePaymentStrategies(userId, validation.data);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error in comparePlans controller:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      err.message || 'Ocurrió un error inesperado al procesar la simulación comparativa de planes de pago',
      req.originalUrl
    );
  }
}

/**
 * POST /api/payment-plans (PLN-002)
 */
async function savePlan(req, res) {
  const userId = extractUserIdFromAuth(req);
  if (!userId) {
    return sendProblemDetails(
      res,
      401,
      'No autorizado',
      'Debe proporcionar un token de autenticación Bearer válido para guardar el plan de pago',
      req.originalUrl
    );
  }

  const validation = savePlanSchema.safeParse(req.body || {});
  if (!validation.success) {
    const invalidParams = validation.error.errors.map(err => ({
      name: err.path.join('.'),
      reason: err.message
    }));
    return sendProblemDetails(
      res,
      422,
      'Error de validación',
      'La estrategia o el orden de liquidación proporcionado no son válidos',
      req.originalUrl,
      invalidParams
    );
  }

  try {
    const saved = await paymentPlansService.selectPaymentPlan(userId, validation.data);
    return res.status(201).json(saved);
  } catch (err) {
    console.error('Error in savePlan controller:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      err.message || 'Ocurrió un error inesperado al persistir el plan de pago',
      req.originalUrl
    );
  }
}

/**
 * GET /api/payment-plans/active (PLN-003)
 */
async function getActivePlan(req, res) {
  const authUserId = extractUserIdFromAuth(req);
  if (!authUserId) {
    return sendProblemDetails(
      res,
      401,
      'No autorizado',
      'Debe proporcionar un token de autenticación Bearer válido para consultar el plan de pago activo',
      req.originalUrl
    );
  }

  // Anti-IDOR: only allow query param if matching authenticated user
  let targetUserId = authUserId;
  if (req.query.user_id && Number(req.query.user_id) !== authUserId) {
    return sendProblemDetails(
      res,
      403,
      'Acceso denegado',
      'No tiene permisos para consultar el plan de pago de otro usuario',
      req.originalUrl
    );
  }

  try {
    const result = await paymentPlansService.getActivePaymentPlan(targetUserId);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error in getActivePlan controller:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      err.message || 'Ocurrió un error inesperado al recuperar el plan de pago activo',
      req.originalUrl
    );
  }
}

module.exports = {
  comparePlans,
  savePlan,
  getActivePlan
};
