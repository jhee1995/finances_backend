const familyService = require('./family.service');
const {
  createFamilySchema,
  addMemberSchema,
  familyIdParamSchema,
  userIdParamSchema,
  familyMemberParamSchema,
  familySummaryQuerySchema
} = require('./family.schemas');

function formatZodErrors(zodError) {
  return zodError.errors.map(err => ({
    name: err.path.join('.'),
    reason: err.message
  }));
}

function sendProblemDetails(res, status, title, detail, instance, invalidParams = null) {
  const errorTypes = {
    404: 'not-found',
    409: 'conflict',
    422: 'validation-error',
    500: 'internal-server-error'
  };

  const problem = {
    type: `https://api.finances.local/errors/${errorTypes[status] || 'unknown-error'}`,
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
 * Handle POST /api/family (Contract: FAM-001)
 */
async function create(req, res) {
  try {
    const parseResult = createFamilySchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación en la solicitud',
        'Los datos proporcionados para crear el núcleo familiar no cumplen las reglas de validación.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const created = await familyService.createFamily(parseResult.data);
    return res.status(201).json(created);
  } catch (err) {
    if (err.name === 'ConflictError') {
      return sendProblemDetails(
        res,
        409,
        'Conflicto de estado familiar',
        err.message,
        req.originalUrl
      );
    }
    if (err.name === 'ValidationError') {
      return sendProblemDetails(
        res,
        422,
        'Error de validación de entidad',
        err.message,
        req.originalUrl,
        err.invalid_params
      );
    }
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'Ocurrió un error inesperado al procesar la creación del núcleo familiar.',
      req.originalUrl
    );
  }
}

/**
 * Handle GET /api/family/:id (Contract: FAM-002)
 */
async function getById(req, res) {
  try {
    const paramParse = familyIdParamSchema.safeParse(req.params);
    if (!paramParse.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetro de ruta inválido',
        'El identificador del núcleo familiar debe ser un número entero positivo.',
        req.originalUrl,
        formatZodErrors(paramParse.error)
      );
    }

    const family = await familyService.getFamilyById(paramParse.data.id);
    return res.status(200).json(family);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return sendProblemDetails(
        res,
        404,
        'Núcleo familiar no encontrado',
        err.message,
        req.originalUrl
      );
    }
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'Ocurrió un error inesperado al consultar el núcleo familiar.',
      req.originalUrl
    );
  }
}

/**
 * Handle GET /api/family/user/:userId (Contract: FAM-003)
 */
async function getByUserId(req, res) {
  try {
    const paramParse = userIdParamSchema.safeParse(req.params);
    if (!paramParse.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetro de ruta inválido',
        'El identificador de usuario debe ser un número entero positivo.',
        req.originalUrl,
        formatZodErrors(paramParse.error)
      );
    }

    const status = await familyService.getFamilyByUserId(paramParse.data.userId);
    return res.status(200).json(status);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return sendProblemDetails(
        res,
        404,
        'Usuario no encontrado',
        err.message,
        req.originalUrl
      );
    }
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'Ocurrió un error inesperado al consultar el núcleo del usuario.',
      req.originalUrl
    );
  }
}

/**
 * Handle POST /api/family/:id/members (Contract: FAM-004)
 */
async function addMember(req, res) {
  try {
    const paramParse = familyIdParamSchema.safeParse(req.params);
    if (!paramParse.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetro de ruta inválido',
        'El identificador del núcleo familiar debe ser un número entero positivo.',
        req.originalUrl,
        formatZodErrors(paramParse.error)
      );
    }

    const bodyParse = addMemberSchema.safeParse(req.body);
    if (!bodyParse.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación en la solicitud',
        'Debe proporcionar un correo electrónico válido o un ID de usuario numérico.',
        req.originalUrl,
        formatZodErrors(bodyParse.error)
      );
    }

    const updated = await familyService.addMember(paramParse.data.id, bodyParse.data);
    return res.status(200).json(updated);
  } catch (err) {
    if (err.name === 'ConflictError') {
      return sendProblemDetails(
        res,
        409,
        'Conflicto de membresía familiar',
        err.message,
        req.originalUrl
      );
    }
    if (err.name === 'NotFoundError') {
      return sendProblemDetails(
        res,
        404,
        'Recurso no encontrado',
        err.message,
        req.originalUrl
      );
    }
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'Ocurrió un error inesperado al asociar el miembro al núcleo familiar.',
      req.originalUrl
    );
  }
}

/**
 * Handle DELETE /api/family/:id/members/:userId (Contract: FAM-005)
 */
async function removeMember(req, res) {
  try {
    const paramParse = familyMemberParamSchema.safeParse(req.params);
    if (!paramParse.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetros de ruta inválidos',
        'El ID de familia y el ID de usuario deben ser números enteros positivos.',
        req.originalUrl,
        formatZodErrors(paramParse.error)
      );
    }

    await familyService.removeMember(paramParse.data.id, paramParse.data.userId);
    return res.status(204).send();
  } catch (err) {
    if (err.name === 'ValidationError') {
      return sendProblemDetails(
        res,
        422,
        'Error de validación',
        err.message,
        req.originalUrl,
        err.invalid_params
      );
    }
    if (err.name === 'NotFoundError') {
      return sendProblemDetails(
        res,
        404,
        'Recurso no encontrado',
        err.message,
        req.originalUrl
      );
    }
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'Ocurrió un error inesperado al desvincular el miembro del núcleo familiar.',
      req.originalUrl
    );
  }
}

/**
 * Handle GET /api/family/:id/summary (Contract: FAM-006)
 */
async function getSummary(req, res) {
  try {
    const paramParse = familyIdParamSchema.safeParse(req.params);
    if (!paramParse.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetro de ruta inválido',
        'El identificador del núcleo familiar debe ser un número entero positivo.',
        req.originalUrl,
        formatZodErrors(paramParse.error)
      );
    }

    const queryParse = familySummaryQuerySchema.safeParse(req.query);
    if (!queryParse.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetro de consulta inválido',
        'El año debe ser un número entero entre 2000 y 2100.',
        req.originalUrl,
        formatZodErrors(queryParse.error)
      );
    }

    const summary = await familyService.getFamilySummary(paramParse.data.id, queryParse.data.year);
    return res.status(200).json(summary);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return sendProblemDetails(
        res,
        404,
        'Núcleo familiar no encontrado',
        err.message,
        req.originalUrl
      );
    }
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'Ocurrió un error inesperado al calcular el consolidado financiero familiar.',
      req.originalUrl
    );
  }
}

module.exports = {
  create,
  getById,
  getByUserId,
  addMember,
  removeMember,
  getSummary
};
