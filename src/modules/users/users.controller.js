const usersService = require('./users.service');
const { createUserSchema, userIdParamSchema, updateUserSchema } = require('./users.schemas');

/**
 * Format Zod validation errors into RFC 7807 problem details
 */
function formatZodError(error) {
  const invalidParams = error.errors.map(err => ({
    name: err.path.join('.'),
    reason: err.message
  }));

  return {
    type: 'https://api.finances.local/errors/validation-error',
    title: 'Error de validación de campos de entrada',
    status: 422,
    detail: 'Uno o más campos enviados no cumplen con las restricciones del contrato',
    invalid_params: invalidParams
  };
}

/**
 * Extract authenticated requester ID from headers, query or body
 */
function getRequesterId(req) {
  if (req.headers && req.headers['x-user-id']) {
    const val = parseInt(req.headers['x-user-id'], 10);
    if (!isNaN(val)) return val;
  }
  if (req.query && req.query.requester_id) {
    const val = parseInt(req.query.requester_id, 10);
    if (!isNaN(val)) return val;
  }
  if (req.user && req.user.id) {
    return parseInt(req.user.id, 10);
  }
  return null;
}

/**
 * POST /api/users
 */
async function createUser(req, res) {
  const parseResult = createUserSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json(formatZodError(parseResult.error));
  }

  try {
    const newUser = await usersService.registerUser(parseResult.data);
    return res.status(201).json(newUser);
  } catch (error) {
    if (error instanceof usersService.ConflictError) {
      return res.status(409)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/conflict',
          title: 'Conflicto por correo electrónico duplicado',
          status: 409,
          detail: error.message
        });
    }

    console.error('Error creating user:', error);
    return res.status(500)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/internal-server-error',
        title: 'Error interno del servidor',
        status: 500,
        detail: 'Ocurrió un error inesperado al procesar la solicitud'
      });
  }
}

/**
 * GET /api/users/:id
 */
async function getUserById(req, res) {
  const paramResult = userIdParamSchema.safeParse(req.params);

  if (!paramResult.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json(formatZodError(paramResult.error));
  }

  const requesterId = getRequesterId(req);

  try {
    const user = await usersService.getUserById(paramResult.data.id, requesterId);
    return res.status(200).json(user);
  } catch (error) {
    if (error instanceof usersService.ForbiddenError) {
      return res.status(403)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/forbidden',
          title: 'Acceso no autorizado al perfil solicitado',
          status: 403,
          detail: error.message
        });
    }

    if (error instanceof usersService.NotFoundError) {
      return res.status(404)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/not-found',
          title: 'Usuario no encontrado',
          status: 404,
          detail: error.message
        });
    }

    console.error('Error getting user by ID:', error);
    return res.status(500).json({ status: 500, detail: 'Error interno del servidor' });
  }
}

/**
 * GET /api/users
 */
async function listUsers(req, res) {
  const requesterId = getRequesterId(req);

  try {
    const users = await usersService.listUsers(req.query, requesterId);
    return res.status(200).json(users);
  } catch (error) {
    if (error instanceof usersService.ForbiddenError) {
      return res.status(403)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/forbidden',
          title: 'Listado de usuarios no autorizado',
          status: 403,
          detail: error.message
        });
    }

    console.error('Error listing users:', error);
    return res.status(500).json({ status: 500, detail: 'Error interno del servidor' });
  }
}

/**
 * PUT /api/users/:id
 */
async function updateUser(req, res) {
  const paramResult = userIdParamSchema.safeParse(req.params);

  if (!paramResult.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json(formatZodError(paramResult.error));
  }

  const bodyResult = updateUserSchema.safeParse(req.body);

  if (!bodyResult.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json(formatZodError(bodyResult.error));
  }

  const requesterId = getRequesterId(req);

  try {
    const updated = await usersService.updateUser(paramResult.data.id, bodyResult.data, requesterId);
    return res.status(200).json(updated);
  } catch (error) {
    if (error instanceof usersService.ForbiddenError) {
      return res.status(403)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/forbidden',
          title: 'Acceso no autorizado para actualizar el perfil',
          status: 403,
          detail: error.message
        });
    }

    if (error instanceof usersService.NotFoundError) {
      return res.status(404)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/not-found',
          title: 'Usuario no encontrado',
          status: 404,
          detail: error.message
        });
    }

    console.error('Error updating user:', error);
    return res.status(500).json({ status: 500, detail: 'Error interno del servidor' });
  }
}

module.exports = {
  createUser,
  getUserById,
  listUsers,
  updateUser
};
