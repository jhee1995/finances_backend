const { z } = require('zod');

const createExpenseSchema = z.preprocess((obj) => {
  if (obj && typeof obj === 'object') {
    const copy = { ...obj };
    // Normalizar amount si el cliente envía expense_amount o incomeAmount
    if (copy.expense_amount !== undefined && copy.amount === undefined) {
      copy.amount = copy.expense_amount;
      delete copy.expense_amount;
    } else if (copy.incomeAmount !== undefined && copy.amount === undefined) {
      copy.amount = copy.incomeAmount;
      delete copy.incomeAmount;
    }
    // Normalizar categoryId a category_id
    if (copy.categoryId !== undefined && copy.category_id === undefined) {
      copy.category_id = copy.categoryId;
      delete copy.categoryId;
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

  category_id: z.coerce.number({
    required_error: 'category_id es requerido',
    invalid_type_error: 'category_id debe ser un número entero'
  }).int('category_id debe ser un número entero').positive('category_id debe ser positivo'),

  amount: z.coerce.number({
    required_error: 'amount es requerido',
    invalid_type_error: 'amount debe ser un número'
  }).positive('amount debe ser mayor a 0'),

  date: z.string({
    required_error: 'date es requerido',
    invalid_type_error: 'date debe ser una cadena de texto'
  }).regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe tener formato YYYY-MM-DD')
    .refine(val => !isNaN(Date.parse(val)), { message: 'date debe ser una fecha cronológicamente válida' })
}).strict({
  message: 'No se permiten propiedades adicionales'
}));

const updateExpenseSchema = z.preprocess((obj) => {
  if (obj && typeof obj === 'object') {
    const copy = { ...obj };
    if (copy.expense_amount !== undefined && copy.amount === undefined) {
      copy.amount = copy.expense_amount;
      delete copy.expense_amount;
    } else if (copy.incomeAmount !== undefined && copy.amount === undefined) {
      copy.amount = copy.incomeAmount;
      delete copy.incomeAmount;
    }
    if (copy.categoryId !== undefined && copy.category_id === undefined) {
      copy.category_id = copy.categoryId;
      delete copy.categoryId;
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

  category_id: z.coerce.number({
    invalid_type_error: 'category_id debe ser un número entero'
  }).int('category_id debe ser un número entero').positive('category_id debe ser positivo').optional(),

  amount: z.coerce.number({
    invalid_type_error: 'amount debe ser un número'
  }).positive('amount debe ser mayor a 0').optional(),

  date: z.string({
    invalid_type_error: 'date debe ser una cadena de texto'
  }).regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe tener formato YYYY-MM-DD')
    .refine(val => !isNaN(Date.parse(val)), { message: 'date debe ser una fecha cronológicamente válida' }).optional()
}).strict({
  message: 'No se permiten propiedades adicionales'
}).refine(data => data.user_id !== undefined || data.category_id !== undefined || data.amount !== undefined || data.date !== undefined || data.name !== undefined, {
  message: 'Debe proporcionar al menos un campo a modificar (user_id, category_id, amount, date o name)'
}));

const expenseIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'El ID del gasto debe ser un número entero positivo').transform(val => parseInt(val, 10))
});

const getExpensesQuerySchema = z.object({
  user_id: z.string().regex(/^\d+$/, 'user_id debe ser un número entero positivo').transform(val => parseInt(val, 10)).optional(),
  category_id: z.string().regex(/^\d+$/, 'category_id debe ser un número entero positivo').transform(val => parseInt(val, 10)).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date debe tener formato YYYY-MM-DD').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end_date debe tener formato YYYY-MM-DD').optional()
});

module.exports = {
  createExpenseSchema,
  updateExpenseSchema,
  expenseIdParamSchema,
  getExpensesQuerySchema
};
