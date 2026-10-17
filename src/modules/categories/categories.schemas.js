const { z } = require('zod');

const createCategorySchema = z.object({
  name: z.string({
    required_error: 'name es requerido',
    invalid_type_error: 'name debe ser una cadena de texto'
  }).trim().min(1, 'name no puede estar vacío').max(20, 'name no puede exceder 20 caracteres'),

  percentage: z.number({
    required_error: 'percentage es requerido',
    invalid_type_error: 'percentage debe ser un número entero'
  }).int('percentage debe ser un número entero')
    .min(1, 'percentage debe ser al menos 1')
    .max(100, 'percentage no puede exceder 100'),

  user_id: z.number({
    invalid_type_error: 'user_id debe ser un número entero'
  }).int('user_id debe ser un número entero').positive('user_id debe ser positivo').optional(),

  family_id: z.number({
    invalid_type_error: 'family_id debe ser un número entero'
  }).int('family_id debe ser un número entero').positive('family_id debe ser positivo').nullable().optional()
}).strict({
  message: 'No se permiten propiedades adicionales'
});

const updateCategorySchema = z.object({
  name: z.string({
    invalid_type_error: 'name debe ser una cadena de texto'
  }).trim().min(1, 'name no puede estar vacío').max(20, 'name no puede exceder 20 caracteres').optional(),

  percentage: z.number({
    invalid_type_error: 'percentage debe ser un número entero'
  }).int('percentage debe ser un número entero')
    .min(1, 'percentage debe ser al menos 1')
    .max(100, 'percentage no puede exceder 100').optional(),

  user_id: z.number({
    invalid_type_error: 'user_id debe ser un número entero'
  }).int('user_id debe ser un número entero').positive('user_id debe ser positivo').optional(),

  family_id: z.number({
    invalid_type_error: 'family_id debe ser un número entero'
  }).int('family_id debe ser un número entero').positive('family_id debe ser positivo').nullable().optional()
}).strict({
  message: 'No se permiten propiedades adicionales'
}).refine(data => data.name !== undefined || data.percentage !== undefined || data.family_id !== undefined, {
  message: 'Debe proporcionar al menos un campo a modificar (name, percentage o family_id)'
});

const categoryIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'El ID de la categoría debe ser un número entero positivo').transform(val => parseInt(val, 10))
});

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  categoryIdParamSchema
};
