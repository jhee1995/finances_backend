const { z } = require('zod');

const createFamilySchema = z.object({
  family_name: z.string({
    required_error: 'El nombre del núcleo familiar es obligatorio'
  })
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres')
  .max(50, 'El nombre no puede exceder 50 caracteres'),
  admin_user_id: z.coerce.number({
    required_error: 'El ID de usuario administrador es requerido'
  })
  .int('El ID de usuario debe ser un número entero')
  .positive('El ID de usuario debe ser mayor a 0')
}).strict();

const addMemberSchema = z.object({
  email: z.string()
    .trim()
    .email('Formato de correo electrónico inválido')
    .optional(),
  user_id: z.coerce.number()
    .int('El ID de usuario debe ser un número entero')
    .positive('El ID de usuario debe ser mayor a 0')
    .optional()
}).strict().refine(data => data.email !== undefined || data.user_id !== undefined, {
  message: 'Debe proporcionar al menos el correo electrónico (email) o el ID de usuario (user_id)',
  path: ['email']
});

const familyIdParamSchema = z.object({
  id: z.coerce.number({
    required_error: 'El ID de familia es requerido'
  })
  .int('El ID de familia debe ser un entero')
  .positive('El ID de familia debe ser mayor a 0')
}).strict();

const userIdParamSchema = z.object({
  userId: z.coerce.number({
    required_error: 'El ID de usuario es requerido'
  })
  .int('El ID de usuario debe ser un entero')
  .positive('El ID de usuario debe ser mayor a 0')
}).strict();

const familyMemberParamSchema = z.object({
  id: z.coerce.number({
    required_error: 'El ID de familia es requerido'
  })
  .int('El ID de familia debe ser un entero')
  .positive('El ID de familia debe ser mayor a 0'),
  userId: z.coerce.number({
    required_error: 'El ID de usuario a desvincular es requerido'
  })
  .int('El ID de usuario debe ser un entero')
  .positive('El ID de usuario debe ser mayor a 0')
}).strict();

const familySummaryQuerySchema = z.object({
  year: z.coerce.number()
    .int('El año debe ser un número entero')
    .min(2000, 'El año debe ser posterior a 2000')
    .max(2100, 'El año no puede superar 2100')
    .optional()
}).strict();

module.exports = {
  createFamilySchema,
  addMemberSchema,
  familyIdParamSchema,
  userIdParamSchema,
  familyMemberParamSchema,
  familySummaryQuerySchema
};
