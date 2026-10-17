const { z } = require('zod');

const createIncomeSchema = z.preprocess((obj) => {
  if (obj && typeof obj === 'object') {
    const copy = { ...obj };
    if (copy.incomeAmount !== undefined && copy.income_amount === undefined) {
      copy.income_amount = copy.incomeAmount;
      delete copy.incomeAmount;
    }
    return copy;
  }
  return obj;
}, z.object({
  user_id: z.coerce.number({
    required_error: 'user_id es requerido',
    invalid_type_error: 'user_id debe ser un número entero'
  }).int('user_id debe ser un número entero').positive('user_id debe ser positivo'),

  name: z.string({
    invalid_type_error: 'name debe ser una cadena de texto'
  }).trim().min(1, 'name no puede estar vacío').max(100, 'name no puede superar 100 caracteres').optional(),

  income_amount: z.coerce.number({
    required_error: 'income_amount es requerido',
    invalid_type_error: 'income_amount debe ser un número'
  }).positive('income_amount debe ser mayor a 0'),

  date: z.string({
    required_error: 'date es requerido',
    invalid_type_error: 'date debe ser una cadena de texto'
  }).regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe tener formato YYYY-MM-DD')
    .refine(val => !isNaN(Date.parse(val)), { message: 'date debe ser una fecha cronológicamente válida' })
}).strict({
  message: 'No se permiten propiedades adicionales'
}));

const updateIncomeSchema = z.preprocess((obj) => {
  if (obj && typeof obj === 'object') {
    const copy = { ...obj };
    if (copy.incomeAmount !== undefined && copy.income_amount === undefined) {
      copy.income_amount = copy.incomeAmount;
      delete copy.incomeAmount;
    }
    return copy;
  }
  return obj;
}, z.object({
  user_id: z.coerce.number({
    invalid_type_error: 'user_id debe ser un número entero'
  }).int('user_id debe ser un número entero').positive('user_id debe ser positivo').optional(),

  name: z.string({
    invalid_type_error: 'name debe ser una cadena de texto'
  }).trim().min(1, 'name no puede estar vacío').max(100, 'name no puede superar 100 caracteres').optional(),

  income_amount: z.coerce.number({
    invalid_type_error: 'income_amount debe ser un número'
  }).positive('income_amount debe ser mayor a 0').optional(),

  date: z.string({
    invalid_type_error: 'date debe ser una cadena de texto'
  }).regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe tener formato YYYY-MM-DD')
    .refine(val => !isNaN(Date.parse(val)), { message: 'date debe ser una fecha cronológicamente válida' }).optional()
}).strict({
  message: 'No se permiten propiedades adicionales'
}).refine(data => data.user_id !== undefined || data.income_amount !== undefined || data.date !== undefined || data.name !== undefined, {
  message: 'Debe proporcionar al menos un campo a modificar (user_id, income_amount, date o name)'
}));

const incomeIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'El ID del ingreso debe ser un número entero positivo').transform(val => parseInt(val, 10))
});

const getIncomesQuerySchema = z.object({
  user_id: z.string().regex(/^\d+$/, 'user_id debe ser un número entero positivo').transform(val => parseInt(val, 10)).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date debe tener formato YYYY-MM-DD').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end_date debe tener formato YYYY-MM-DD').optional()
});

module.exports = {
  createIncomeSchema,
  updateIncomeSchema,
  incomeIdParamSchema,
  getIncomesQuerySchema
};
