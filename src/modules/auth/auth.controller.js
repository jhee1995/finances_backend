const authService = require('./auth.service');
const { loginSchema, registerSchema } = require('./auth.schemas');

/**
 * Format Zod validation errors into RFC 7807 problem details
 */
function formatZodError(error, instance = '/api/auth') {
  const invalidParams = error.errors.map(err => ({
    name: err.path.join('.'),
    reason: err.message
  }));

  return {
    type: 'https://api.finances.local/errors/validation-error',
    title: 'Error de validación de campos de entrada',
    status: 422,
    detail: 'Uno o más campos enviados no cumplen con las restricciones del contrato',
    instance,
    invalid_params: invalidParams
  };
}

/**
 * POST /api/auth/login
 * Contract: AUTH-001
 */
async function login(req, res) {
  const parseResult = loginSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json(formatZodError(parseResult.error, '/api/auth/login'));
  }

  try {
    const result = await authService.authenticate(parseResult.data.email, parseResult.data.password);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof authService.AuthenticationError) {
      return res.status(401)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/unauthorized',
          title: 'Error de autenticación',
          status: 401,
          detail: error.message,
          instance: '/api/auth/login'
        });
    }

    console.error('Error during login:', error);
    return res.status(500)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/internal-server-error',
        title: 'Error interno del servidor',
        status: 500,
        detail: 'Ocurrió un error inesperado al procesar la autenticación',
        instance: '/api/auth/login'
      });
  }
}

/**
 * POST /api/auth/register
 * Contract: AUTH-002
 */
async function register(req, res) {
  const parseResult = registerSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json(formatZodError(parseResult.error, '/api/auth/register'));
  }

  try {
    const newUser = await authService.register(parseResult.data);
    return res.status(201).json(newUser);
  } catch (error) {
    if (error instanceof authService.ConflictError) {
      return res.status(409)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/conflict',
          title: 'Conflicto por correo electrónico duplicado',
          status: 409,
          detail: error.message,
          instance: '/api/auth/register'
        });
    }

    console.error('Error registering user with password:', error);
    return res.status(500)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/internal-server-error',
        title: 'Error interno del servidor',
        status: 500,
        detail: 'Ocurrió un error inesperado al registrar el usuario',
        instance: '/api/auth/register'
      });
  }
}

module.exports = {
  login,
  register
};
