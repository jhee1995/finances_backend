const { z } = require('zod');

const currentYear = new Date().getFullYear();

const getDashboardSummaryQuerySchema = z.object({
  user_id: z.string({
    required_error: 'user_id es requerido'
  }).regex(/^\d+$/, 'user_id debe ser un número entero positivo').transform(val => parseInt(val, 10)),

  year: z.string().regex(/^\d{4}$/, 'year debe ser un año válido de 4 dígitos')
    .transform(val => parseInt(val, 10))
    .refine(val => val >= 1900 && val <= 2100, { message: 'year debe estar entre 1900 y 2100' })
    .optional()
    .default(String(currentYear))
});

module.exports = {
  getDashboardSummaryQuerySchema
};
