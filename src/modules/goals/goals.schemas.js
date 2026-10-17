const { z } = require('zod');

// Normalizer for camelCase and snake_case flexibility
function normalizeGoalKeys(obj) {
  if (obj && typeof obj === 'object') {
    const copy = { ...obj };

    if (copy.goalname !== undefined && copy.goalName === undefined) {
      copy.goalName = copy.goalname;
      delete copy.goalname;
    }

    if (copy.current_amount !== undefined && copy.currentAmount === undefined) {
      copy.currentAmount = copy.current_amount;
      delete copy.current_amount;
    }

    if (copy.target_date !== undefined && copy.targetDate === undefined) {
      copy.targetDate = copy.target_date;
      delete copy.target_date;
    }

    if (copy.isdebt !== undefined && copy.isDebt === undefined) {
      copy.isDebt = copy.isdebt;
      delete copy.isdebt;
    }

    if (copy.debtid !== undefined && copy.debtId === undefined) {
      copy.debtId = copy.debtid;
      delete copy.debtid;
    }

    if (copy.user_id !== undefined && copy.userId === undefined) {
      copy.userId = copy.user_id;
      delete copy.user_id;
    }

    return copy;
  }
  return obj;
}

const createGoalSchema = z.preprocess(normalizeGoalKeys, z.object({
  userId: z.coerce.number({
    invalid_type_error: 'userId debe ser un número entero'
  }).int('userId debe ser un entero').positive('userId debe ser positivo').optional(),

  goalName: z.string({
    required_error: 'goalName es requerido',
    invalid_type_error: 'goalName debe ser una cadena de texto'
  }).trim().min(2, 'goalName debe contener al menos 2 caracteres').max(100, 'goalName no debe exceder 100 caracteres'),

  amount: z.coerce.number({
    required_error: 'amount es requerido',
    invalid_type_error: 'amount debe ser un número'
  }).positive('amount debe ser mayor a 0'),

  currentAmount: z.coerce.number({
    invalid_type_error: 'currentAmount debe ser un número'
  }).min(0, 'currentAmount no puede ser negativo').default(0),

  targetDate: z.string({
    invalid_type_error: 'targetDate debe ser una fecha en formato YYYY-MM-DD'
  }).regex(/^\d{4}-\d{2}-\d{2}$/, 'targetDate debe tener formato YYYY-MM-DD').nullable().optional(),

  isDebt: z.coerce.boolean({
    invalid_type_error: 'isDebt debe ser booleano'
  }).default(false),

  debtId: z.coerce.number({
    invalid_type_error: 'debtId debe ser un número entero'
  }).int('debtId debe ser un entero').positive('debtId debe ser positivo').nullable().optional()
})).refine(data => {
  if (data.isDebt && !data.debtId) {
    return false;
  }
  return true;
}, {
  message: 'debtId es requerido cuando isDebt es verdadero',
  path: ['debtId']
});

const updateGoalSchema = z.preprocess(normalizeGoalKeys, z.object({
  userId: z.coerce.number().int().positive().optional(),
  goalName: z.string().trim().min(2, 'goalName debe contener al menos 2 caracteres').max(100, 'goalName no debe exceder 100 caracteres').optional(),
  amount: z.coerce.number().positive('amount debe ser mayor a 0').optional(),
  currentAmount: z.coerce.number().min(0, 'currentAmount no puede ser negativo').optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'targetDate debe tener formato YYYY-MM-DD').nullable().optional(),
  isDebt: z.coerce.boolean().optional(),
  debtId: z.coerce.number().int().positive().nullable().optional()
}));

const getGoalsQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  includeFamily: z.preprocess(val => {
    if (typeof val === 'string') {
      return val.toLowerCase() === 'true' || val === '1';
    }
    return Boolean(val);
  }, z.boolean()).default(false)
});

module.exports = {
  createGoalSchema,
  updateGoalSchema,
  getGoalsQuerySchema
};
