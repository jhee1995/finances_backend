const debtsService = require('./debts.service');
const {
  createDebtSchema,
  updateDebtSchema,
  listDebtsQuerySchema,
  debtIdParamSchema,
  simulateDebtSchema,
  createDebtPaymentSchema
} = require('./debts.schemas');

function formatZodErrors(zodError) {
  return zodError.errors.map(err => ({
    name: err.path.join('.'),
    reason: err.message
  }));
}

function sendProblemDetails(res, status, title, detail, instance, invalidParams = null) {
  const errorTypes = {
    401: 'unauthorized',
    403: 'forbidden',
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
 * Handle POST /api/debts (Contract: DEB-001)
 */
async function create(req, res) {
  try {
    const parseResult = createDebtSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación en la solicitud',
        'Los datos proporcionados para registrar la deuda no cumplen las reglas de validación.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const created = await debtsService.registerDebt(parseResult.data);
    return res.status(201).json(created);
  } catch (err) {
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

    console.error('Error creating debt:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible registrar la obligación financiera.',
      req.originalUrl
    );
  }
}

/**
 * Handle GET /api/debts (Contract: DEB-002)
 */
async function list(req, res) {
  try {
    const parseResult = listDebtsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación en parámetros de consulta',
        'Los parámetros de filtro proporcionados son inválidos.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const debts = await debtsService.getDebts(parseResult.data);
    return res.status(200).json(debts);
  } catch (err) {
    console.error('Error listing debts:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible listar las obligaciones financieras.',
      req.originalUrl
    );
  }
}

/**
 * Handle GET /api/debts/:id (Contract: DEB-003)
 */
async function getById(req, res) {
  try {
    const paramResult = debtIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación de parámetro de ruta',
        'El identificador proporcionado debe ser un número entero positivo.',
        req.originalUrl,
        formatZodErrors(paramResult.error)
      );
    }

    const debt = await debtsService.getDebt(paramResult.data.id);
    return res.status(200).json(debt);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return sendProblemDetails(
        res,
        404,
        'Obligación financiera no encontrada',
        err.message,
        req.originalUrl
      );
    }

    console.error('Error fetching debt by id:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible consultar la obligación financiera.',
      req.originalUrl
    );
  }
}

/**
 * Handle PUT /api/debts/:id (Contract: DEB-004)
 */
async function update(req, res) {
  try {
    const paramResult = debtIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación de parámetro de ruta',
        'El identificador proporcionado debe ser un número entero positivo.',
        req.originalUrl,
        formatZodErrors(paramResult.error)
      );
    }

    const bodyResult = updateDebtSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación en la actualización',
        'Los datos proporcionados para actualizar la deuda son inválidos.',
        req.originalUrl,
        formatZodErrors(bodyResult.error)
      );
    }

    const updated = await debtsService.modifyDebt(paramResult.data.id, bodyResult.data);
    return res.status(200).json(updated);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return sendProblemDetails(
        res,
        404,
        'Obligación financiera no encontrada',
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

    console.error('Error updating debt:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible actualizar la obligación financiera.',
      req.originalUrl
    );
  }
}

/**
 * Handle DELETE /api/debts/:id (Contract: DEB-005)
 */
async function remove(req, res) {
  try {
    const paramResult = debtIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación de parámetro de ruta',
        'El identificador proporcionado debe ser un número entero positivo.',
        req.originalUrl,
        formatZodErrors(paramResult.error)
      );
    }

    const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : (req.body?.user_id ? parseInt(req.body.user_id, 10) : null);
    await debtsService.removeDebt(paramResult.data.id, userId);
    return res.status(204).send();
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return sendProblemDetails(
        res,
        404,
        'Obligación financiera no encontrada',
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

    console.error('Error deleting debt:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible eliminar la obligación financiera.',
      req.originalUrl
    );
  }
}

/**
 * Handle POST /api/debts/simulate (Contract: DEB-006, US-009)
 */
async function simulate(req, res) {
  try {
    // RBAC & Authentication verification (Contract DEB-006: auth_required: true, Scenario 8)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendProblemDetails(
        res,
        401,
        'No autenticado',
        'La solicitud requiere una cabecera Authorization: Bearer <token> válida.',
        req.originalUrl
      );
    }

    let actingUserId = null;
    const token = authHeader.substring(7).trim();
    if (token) {
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [userIdStr] = decoded.split(':');
        if (userIdStr && !isNaN(Number(userIdStr))) {
          actingUserId = Number(userIdStr);
        }
      } catch (e) {
        // Fallback if token is not base64 encoded
      }
    }
    if (!actingUserId && req.body && req.body.user_id) {
      actingUserId = Number(req.body.user_id);
    }

    const parseResult = simulateDebtSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación en la simulación',
        'Los parámetros suministrados para la simulación de crédito no cumplen las reglas requeridas.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const simulation = await debtsService.simulateDebt(parseResult.data, actingUserId);
    return res.status(200).json(simulation);
  } catch (err) {
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
    if (err.name === 'NotFoundError' || err.status === 404) {
      return sendProblemDetails(
        res,
        404,
        'Obligación no encontrada',
        err.message,
        req.originalUrl
      );
    }
    if (err.name === 'ForbiddenError' || err.status === 403) {
      return sendProblemDetails(
        res,
        403,
        'Acceso denegado',
        err.message,
        req.originalUrl
      );
    }
    console.error('Error simulating debt amortization:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      err.message || 'Ocurrió un error inesperado al procesar la simulación.',
      req.originalUrl
    );
  }
}

/**
 * Handle POST /api/debts/:id/payments (Contract: DEB-007, US-019)
 */
async function createPayment(req, res) {
  try {
    const paramParse = debtIdParamSchema.safeParse(req.params);
    if (!paramParse.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación en parámetro',
        'El identificador de la obligación financiera debe ser un número entero positivo.',
        req.originalUrl,
        formatZodErrors(paramParse.error)
      );
    }

    const bodyParse = createDebtPaymentSchema.safeParse(req.body);
    if (!bodyParse.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación en la solicitud de abono',
        'Los datos proporcionados para registrar el abono no cumplen las reglas de validación.',
        req.originalUrl,
        formatZodErrors(bodyParse.error)
      );
    }

    let actingUserId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token) {
        try {
          const decoded = Buffer.from(token, 'base64').toString('utf8');
          const [userIdStr] = decoded.split(':');
          if (userIdStr && !isNaN(Number(userIdStr))) {
            actingUserId = Number(userIdStr);
          }
        } catch (e) {
          // ignore
        }
      }
    }
    if (!actingUserId && bodyParse.data.user_id) {
      actingUserId = Number(bodyParse.data.user_id);
    }

    const result = await debtsService.recordDebtPayment(paramParse.data.id, bodyParse.data, actingUserId);
    return res.status(201).json(result);
  } catch (err) {
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
    if (err.name === 'NotFoundError' || err.status === 404) {
      return sendProblemDetails(
        res,
        404,
        'Obligación no encontrada',
        err.message,
        req.originalUrl
      );
    }
    if (err.name === 'ForbiddenError' || err.status === 403) {
      return sendProblemDetails(
        res,
        403,
        'Acceso denegado',
        err.message,
        req.originalUrl
      );
    }
    console.error('Error recording debt payment:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible registrar el abono a la obligación financiera.',
      req.originalUrl
    );
  }
}

/**
 * Handle GET /api/debts/:id/payments (Contract: DEB-008, US-019)
 */
async function listPayments(req, res) {
  try {
    const paramParse = debtIdParamSchema.safeParse(req.params);
    if (!paramParse.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación en parámetro',
        'El identificador de la obligación financiera debe ser un número entero positivo.',
        req.originalUrl,
        formatZodErrors(paramParse.error)
      );
    }

    let actingUserId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token) {
        try {
          const decoded = Buffer.from(token, 'base64').toString('utf8');
          const [userIdStr] = decoded.split(':');
          if (userIdStr && !isNaN(Number(userIdStr))) {
            actingUserId = Number(userIdStr);
          }
        } catch (e) {
          // ignore
        }
      }
    }

    const payments = await debtsService.getDebtPayments(paramParse.data.id, actingUserId);
    return res.status(200).json(payments);
  } catch (err) {
    if (err.name === 'NotFoundError' || err.status === 404) {
      return sendProblemDetails(
        res,
        404,
        'Obligación no encontrada',
        err.message,
        req.originalUrl
      );
    }
    if (err.name === 'ForbiddenError' || err.status === 403) {
      return sendProblemDetails(
        res,
        403,
        'Acceso denegado',
        err.message,
        req.originalUrl
      );
    }
    console.error('Error fetching debt payments:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible consultar el historial de abonos.',
      req.originalUrl
    );
  }
}

module.exports = {
  create,
  list,
  getById,
  update,
  remove,
  simulate,
  createPayment,
  listPayments
};
