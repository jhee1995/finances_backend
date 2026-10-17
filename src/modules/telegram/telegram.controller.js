const telegramService = require('./telegram.service');
const {
  generateTokenSchema,
  linkTelegramSchema,
  statusQuerySchema,
  testNotificationSchema,
  webhookSchema,
  chatSimulateSchema
} = require('./telegram.schemas');

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
 * POST /api/telegram/generate-token (Contract: TEL-001)
 */
async function generateToken(req, res) {
  try {
    const authUserId = extractUserIdFromAuth(req);
    const parseResult = generateTokenSchema.safeParse(req.body || {});

    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación',
        'Parámetros inválidos para generar token.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const userId = parseResult.data.userId || authUserId || 1;
    const result = await telegramService.generateToken(userId);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error generating telegram token:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible generar el token de vinculación de Telegram.',
      req.originalUrl
    );
  }
}

/**
 * POST /api/telegram/link (Contract: TEL-002)
 */
async function link(req, res) {
  try {
    const authUserId = extractUserIdFromAuth(req);
    const parseResult = linkTelegramSchema.safeParse(req.body);

    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación al vincular Telegram',
        'Uno o más parámetros para la vinculación son incorrectos.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const payload = parseResult.data;
    const userId = payload.userId || authUserId || 1;

    const result = await telegramService.linkTelegram({
      userId,
      chatId: payload.chatId,
      token: payload.token
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('Error linking telegram account:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible vincular la cuenta de Telegram.',
      req.originalUrl
    );
  }
}

/**
 * GET /api/telegram/status (Contract: TEL-003)
 */
async function getStatus(req, res) {
  try {
    const authUserId = extractUserIdFromAuth(req);
    const parseResult = statusQuerySchema.safeParse(req.query || {});

    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetros inválidos',
        'El parámetro userId es inválido.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const userId = parseResult.data.userId || authUserId || 1;
    const status = await telegramService.getStatus(userId);
    return res.status(200).json(status);
  } catch (err) {
    console.error('Error checking telegram status:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible consultar el estado de Telegram.',
      req.originalUrl
    );
  }
}

/**
 * POST /api/telegram/test-notification (Contract: TEL-004)
 */
async function testNotification(req, res) {
  try {
    const authUserId = extractUserIdFromAuth(req);
    const parseResult = testNotificationSchema.safeParse(req.body || {});

    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetros inválidos',
        'Los datos de la notificación son inválidos.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const payload = parseResult.data;
    const userId = payload.userId || authUserId || 1;

    const result = await telegramService.sendNotification({
      userId,
      message: payload.message || '🔔 Notificación de prueba de Finanzas Personales'
    });

    return res.status(200).json(result);
  } catch (err) {
    if (err.status === 404) {
      return sendProblemDetails(
        res,
        404,
        'Cuenta de Telegram no vinculada',
        err.message,
        req.originalUrl
      );
    }

    console.error('Error sending test notification:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible procesar la notificación de Telegram.',
      req.originalUrl
    );
  }
}

/**
 * DELETE /api/telegram/link (Contract: TEL-005)
 */
async function unlink(req, res) {
  try {
    const authUserId = extractUserIdFromAuth(req);
    const parseResult = statusQuerySchema.safeParse(req.query || {});

    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetros inválidos',
        'El parámetro userId es inválido.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const userId = parseResult.data.userId || authUserId || 1;
    await telegramService.unlinkTelegram(userId);
    return res.status(204).send();
  } catch (err) {
    if (err.status === 404) {
      return sendProblemDetails(
        res,
        404,
        'Vinculación no encontrada',
        err.message,
        req.originalUrl
      );
    }

    console.error('Error unlinking telegram:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible desvincular la cuenta de Telegram.',
      req.originalUrl
    );
  }
}

/**
 * POST /api/telegram/webhook (Contract: BOT-001)
 */
async function handleWebhook(req, res) {
  try {
    const parseResult = webhookSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Error de validación del webhook',
        'El payload de actualización de Telegram es inválido.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const result = await telegramService.processWebhook(parseResult.data);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error processing telegram webhook:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible procesar la actualización del webhook de Telegram.',
      req.originalUrl
    );
  }
}

/**
 * POST /api/telegram/chat-simulate (Contract: BOT-002)
 */
async function simulateChat(req, res) {
  try {
    const authUserId = extractUserIdFromAuth(req);
    const parseResult = chatSimulateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendProblemDetails(
        res,
        422,
        'Parámetros inválidos',
        'El mensaje a simular no es válido.',
        req.originalUrl,
        formatZodErrors(parseResult.error)
      );
    }

    const payload = parseResult.data;
    const userId = payload.userId || authUserId || 1;

    const result = await telegramService.simulateChat({
      userId,
      message: payload.message
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('Error simulating telegram chat:', err);
    return sendProblemDetails(
      res,
      500,
      'Error interno del servidor',
      'No fue posible simular el mensaje del bot de Telegram.',
      req.originalUrl
    );
  }
}

module.exports = {
  generateToken,
  link,
  getStatus,
  testNotification,
  unlink,
  handleWebhook,
  simulateChat
};
