const { z } = require('zod');

const createUserSchema = z.object({
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

  family_core: z.number().int().positive().nullable().optional()
}).strict({
  message: 'No se permiten propiedades adicionales'
});

const userIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'El ID de usuario debe ser un número entero positivo').transform(val => parseInt(val, 10))
});

const updateUserSchema = z.object({
  first_name: z.string({
    required_error: 'first_name es requerido',
    invalid_type_error: 'first_name debe ser una cadena de texto'
  }).trim().min(1, 'first_name no puede estar vacío').max(50, 'first_name no puede exceder 50 caracteres'),

  middle_name: z.string().trim().max(50, 'middle_name no puede exceder 50 caracteres').nullable().optional(),

  last_name: z.string({
    required_error: 'last_name es requerido',
    invalid_type_error: 'last_name debe ser una cadena de texto'
  }).trim().min(1, 'last_name no puede estar vacío').max(50, 'last_name no puede exceder 50 caracteres')
}).strict({
  message: 'No se permiten propiedades adicionales'
});

module.exports = {
  createUserSchema,
  userIdParamSchema,
  updateUserSchema
};
