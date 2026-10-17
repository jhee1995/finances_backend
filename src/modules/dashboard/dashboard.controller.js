const dashboardService = require('./dashboard.service');
const { getDashboardSummaryQuerySchema } = require('./dashboard.schemas');

function formatZodErrors(zodError) {
  return zodError.errors.map(err => ({
    name: err.path.join('.'),
    reason: err.message
  }));
}

/**
 * Handle GET /api/dashboard/summary (Contract: DSH-001)
 */
async function getSummary(req, res) {
  try {
    const parseResult = getDashboardSummaryQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(422).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación en los parámetros de consulta',
        status: 422,
        detail: 'Los parámetros proporcionados para el dashboard son inválidos',
        instance: req.originalUrl,
        invalid_params: formatZodErrors(parseResult.error)
      });
    }

    const summary = await dashboardService.getDashboardSummary(parseResult.data);
    return res.status(200).json(summary);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(422).contentType('application/problem+json').json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación de entidad',
        status: 422,
        detail: err.message,
        instance: req.originalUrl,
        invalid_params: err.invalid_params || []
      });
    }

    console.error('Error fetching dashboard summary:', err);
    return res.status(500).contentType('application/problem+json').json({
      type: 'https://api.finances.local/errors/internal-server-error',
      title: 'Error interno del servidor',
      status: 500,
      detail: 'No fue posible generar el resumen del dashboard',
      instance: req.originalUrl
    });
  }
}

module.exports = {
  getSummary
};
