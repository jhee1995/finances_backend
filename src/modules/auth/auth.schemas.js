const { z } = require('zod');

const loginSchema = z.object({
  email: z.string({
    required_error: 'email es requerido',
    invalid_type_error: 'email debe ser una cadena de texto'
  }).trim().email('Formato de correo electrónico inválido').max(100, 'email no puede exceder 100 caracteres'),

  password: z.string({
    required_error: 'password es requerido',
    invalid_type_error: 'password debe ser una cadena de texto'
  }).min(1, 'password no puede estar vacío').max(128, 'password no puede exceder 128 caracteres')
}).strict({
  message: 'No se permiten propiedades adicionales'
});

const registerSchema = z.object({
  first_name: z.string({
    required_error: 'first_name es requerido',
    invalid_type_error: 'first_name debe ser una cadena de texto'
  }).trim().min(1, 'first_name no puede estar vacío').max(50, 'first_name no puede exceder 50 caracteres'),

  middle_name: z.string().trim().max(50, 'middle_name no puede exceder 50 caracteres').nullable().optional(),

  last_name: z.string({
    required_error: 'last_name es requerido',
    invalid_type_error: 'last_name debe ser una cadena de texto'
  }).trim().min(1, 'last_name no puede estar vacío').max(50, 'last_name no puede exceder 50 caracteres'),

  email: z.string({
    required_error: 'email es requerido'
  }).trim().email('Formato de correo electrónico inválido').max(100, 'email no puede exceder 100 caracteres'),

  password: z.string({
    invalid_type_error: 'password debe ser una cadena de texto'
  }).min(8, 'La contraseña debe tener al menos 8 caracteres').max(128, 'La contraseña no puede exceder 128 caracteres').optional(),

  family_core: z.number().int().positive().nullable().optional()
}).strict({
  message: 'No se permiten propiedades adicionales'
});

module.exports = {
  loginSchema,
  registerSchema
};
