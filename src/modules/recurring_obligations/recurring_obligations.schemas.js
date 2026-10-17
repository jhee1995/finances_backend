const { z } = require('zod');

function normalizeKeys(obj) {
  if (obj && typeof obj === 'object') {
    const copy = { ...obj };
    if (copy.userId !== undefined && copy.user_id === undefined) {
      copy.user_id = copy.userId;
      delete copy.userId;
    }
    if (copy.categoryId !== undefined && copy.category_id === undefined) {
      copy.category_id = copy.categoryId;
      delete copy.categoryId;
    }
    if (copy.dueDay !== undefined && copy.due_day === undefined) {
      copy.due_day = copy.dueDay;
      delete copy.dueDay;
    }
    if (copy.dueDaySecondary !== undefined && copy.due_day_secondary === undefined) {
      copy.due_day_secondary = copy.dueDaySecondary;
      delete copy.dueDaySecondary;
    }
    if (copy.isFamily !== undefined && copy.is_family === undefined) {
      copy.is_family = copy.isFamily;
      delete copy.isFamily;
    }
    return copy;
  }
  return obj;
}

const createRecurringObligationSchema = z.preprocess(normalizeKeys, z.object({
  user_id: z.coerce.number({
    invalid_type_error: 'user_id debe ser un número entero'
  }).int().positive().optional(),

  name: z.string({
    required_error: 'El nombre es obligatorio',
    invalid_type_error: 'El nombre debe ser una cadena de texto'
  }).trim().min(1, 'El nombre no puede estar vacío').max(120, 'El nombre no puede exceder 120 caracteres'),

  amount: z.coerce.number({
    required_error: 'El monto es obligatorio',
    invalid_type_error: 'El monto debe ser un número'
  }).positive('El monto debe ser mayor a 0'),

  frequency: z.enum(['MENSUAL', 'QUINCENAL'], {
    required_error: 'La frecuencia es obligatoria',
    invalid_type_error: 'La frecuencia debe ser MENSUAL o QUINCENAL'
  }),

  due_day: z.coerce.number({
    required_error: 'El día habitual de pago (due_day) es obligatorio',
    invalid_type_error: 'due_day debe ser un número entero'
  }).int().min(1, 'due_day debe ser mínimo 1').max(31, 'due_day no puede ser mayor a 31'),

  due_day_secondary: z.coerce.number({
    invalid_type_error: 'due_day_secondary debe ser un número entero'
  }).int().min(1, 'due_day_secondary debe ser mínimo 1').max(31, 'due_day_secondary no puede ser mayor a 31').optional().nullable(),

  category_id: z.coerce.number({
    required_error: 'category_id es obligatorio',
    invalid_type_error: 'category_id debe ser un número entero'
  }).int().positive('category_id debe ser un entero positivo'),

  is_family: z.boolean().optional().default(false),

  notes: z.string().max(255, 'Las notas no pueden superar 255 caracteres').optional().nullable()
}));

const payRecurringObligationSchema = z.object({
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_date debe tener formato YYYY-MM-DD').optional(),
  actual_amount: z.coerce.number().positive('actual_amount debe ser mayor a 0').optional(),
  period_year: z.coerce.number({
    required_error: 'period_year es obligatorio'
  }).int().min(2000, 'period_year mínimo 2000').max(2100, 'period_year máximo 2100'),
  period_month: z.coerce.number({
    required_error: 'period_month es obligatorio'
  }).int().min(1, 'period_month debe estar entre 1 y 12').max(12, 'period_month debe estar entre 1 y 12'),
  period_cycle: z.coerce.number().int().min(1).max(2).optional().default(1),
  user_id: z.coerce.number().int().positive().optional(),
  notes: z.string().max(255).optional().nullable()
});

const periodStatusQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  cycle: z.coerce.number().int().min(1).max(2).optional(),
  user_id: z.coerce.number().int().positive().optional(),
  include_family: z.preprocess((val) => {
    if (val === 'true' || val === true) return true;
    if (val === 'false' || val === false) return false;
    return undefined;
  }, z.boolean().optional())
});

module.exports = {
  createRecurringObligationSchema,
  payRecurringObligationSchema,
  periodStatusQuerySchema
};
