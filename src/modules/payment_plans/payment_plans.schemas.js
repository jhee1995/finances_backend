const { z } = require('zod');

const STRATEGIES_ENUM = ['AVALANCHE', 'SNOWBALL', 'TSUNAMI', 'CONSOLIDATION', 'SNOWFLAKE'];

const comparePlansSchema = z.object({
  extraMonthlyBudget: z.coerce
    .number({ invalid_type_error: 'El presupuesto adicional debe ser un valor numérico' })
    .min(0, 'El presupuesto adicional no puede ser negativo')
    .optional()
    .default(0),
  consolidationRateEA: z.coerce
    .number({ invalid_type_error: 'La tasa de consolidación debe ser un valor numérico' })
    .min(0, 'La tasa de consolidación no puede ser negativa')
    .max(200, 'La tasa de consolidación no puede exceder el 200% EA')
    .optional()
    .default(16.0),
  snowflakeAmount: z.coerce
    .number({ invalid_type_error: 'El monto de copos de nieve debe ser un valor numérico' })
    .min(0, 'El monto de copos de nieve no puede ser negativo')
    .optional()
    .default(0),
  includeFamilyDebts: z.coerce
    .boolean()
    .optional()
    .default(true)
}).strict();

const savePlanSchema = z.object({
  strategy: z.enum(STRATEGIES_ENUM, {
    errorMap: () => ({ message: `La estrategia seleccionada es inválida. Opciones: ${STRATEGIES_ENUM.join(', ')}` })
  }),
  order: z.array(
    z.coerce.number().int().positive('Los identificadores de deuda deben ser enteros positivos')
  ).min(1, 'El orden de liquidación debe incluir al menos una obligación'),
  extraMonthlyBudget: z.coerce
    .number({ invalid_type_error: 'El presupuesto adicional debe ser un valor numérico' })
    .min(0, 'El presupuesto adicional no puede ser negativo')
    .optional()
    .default(0),
  remainingAmount: z.coerce
    .number({ invalid_type_error: 'El monto remanente debe ser un valor numérico' })
    .min(0, 'El monto remanente no puede ser negativo')
    .optional()
}).strict();

module.exports = {
  comparePlansSchema,
  savePlanSchema,
  STRATEGIES_ENUM
};
