const categoriesService = require('./categories.service');
const {
  createCategorySchema,
  updateCategorySchema,
  categoryIdParamSchema
} = require('./categories.schemas');

/**
 * Format Zod validation errors into RFC 7807 problem details
 */
function formatZodError(error) {
  const invalidParams = error.errors.map(err => ({
    name: err.path.join('.'),
    reason: err.message
  }));

  return {
    type: 'https://api.finances.local/errors/validation-error',
    title: 'Error de validación de campos de entrada',
    status: 422,
    detail: 'Uno o más campos enviados no cumplen con las restricciones del contrato',
    instance: '/api/categories',
    invalid_params: invalidParams
  };
}

/**
 * POST /api/categories
 * Contract: CAT-001
 */
async function createCategory(req, res) {
  const parseResult = createCategorySchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json(formatZodError(parseResult.error));
  }

  try {
    const newCategory = await categoriesService.registerCategory(parseResult.data);
    return res.status(201).json({
      id: parseInt(newCategory.id, 10),
      name: newCategory.name,
      percentage: parseInt(newCategory.percentage, 10),
      user_id: newCategory.user_id ? parseInt(newCategory.user_id, 10) : null,
      family_id: newCategory.family_id ? parseInt(newCategory.family_id, 10) : null
    });
  } catch (error) {
    if (error instanceof categoriesService.ConflictError) {
      return res.status(409)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/conflict',
          title: 'Conflicto por nombre de categoría duplicado',
          status: 409,
          detail: error.message,
          instance: '/api/categories'
        });
    }

    console.error('Error creating category:', error);
    return res.status(500)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/internal-server-error',
        title: 'Error interno del servidor',
        status: 500,
        detail: 'Ocurrió un error inesperado al procesar la solicitud',
        instance: '/api/categories'
      });
  }
}

/**
 * GET /api/categories
 * Contract: CAT-002
 */
async function getCategories(req, res) {
  try {
    const userIdQuery = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
    const categories = await categoriesService.listCategories(userIdQuery);
    return res.status(200).json(
      categories.map(c => ({
        id: parseInt(c.id, 10),
        name: c.name,
        percentage: parseInt(c.percentage, 10),
        user_id: c.user_id ? parseInt(c.user_id, 10) : null,
        family_id: c.family_id ? parseInt(c.family_id, 10) : null
      }))
    );
  } catch (error) {
    console.error('Error listing categories:', error);
    return res.status(500)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/internal-server-error',
        title: 'Error interno del servidor',
        status: 500,
        detail: 'Ocurrió un error inesperado al consultar las categorías',
        instance: '/api/categories'
      });
  }
}

/**
 * GET /api/categories/:id
 * Contract: CAT-003
 */
async function getCategoryById(req, res) {
  const paramParse = categoryIdParamSchema.safeParse(req.params);

  if (!paramParse.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación de identificador',
        status: 422,
        detail: 'El parámetro :id debe ser un entero positivo',
        instance: `/api/categories/${req.params.id}`,
        invalid_params: [{ name: 'id', reason: 'Debe ser un número entero positivo' }]
      });
  }

  try {
    const category = await categoriesService.getCategoryById(paramParse.data.id);
    return res.status(200).json({
      id: parseInt(category.id, 10),
      name: category.name,
      percentage: parseInt(category.percentage, 10),
      user_id: category.user_id ? parseInt(category.user_id, 10) : null,
      family_id: category.family_id ? parseInt(category.family_id, 10) : null
    });
  } catch (error) {
    if (error instanceof categoriesService.NotFoundError) {
      return res.status(404)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/not-found',
          title: 'Categoría no encontrada',
          status: 404,
          detail: error.message,
          instance: `/api/categories/${req.params.id}`
        });
    }

    console.error('Error fetching category by id:', error);
    return res.status(500)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/internal-server-error',
        title: 'Error interno del servidor',
        status: 500,
        detail: 'Ocurrió un error inesperado al consultar la categoría',
        instance: `/api/categories/${req.params.id}`
      });
  }
}

/**
 * PUT /api/categories/:id
 * Contract: CAT-004
 */
async function updateCategory(req, res) {
  const paramParse = categoryIdParamSchema.safeParse(req.params);

  if (!paramParse.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación de identificador',
        status: 422,
        detail: 'El parámetro :id debe ser un entero positivo',
        instance: `/api/categories/${req.params.id}`,
        invalid_params: [{ name: 'id', reason: 'Debe ser un número entero positivo' }]
      });
  }

  const bodyParse = updateCategorySchema.safeParse(req.body);

  if (!bodyParse.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json(formatZodError(bodyParse.error));
  }

  try {
    const updated = await categoriesService.updateCategory(paramParse.data.id, bodyParse.data);
    return res.status(200).json({
      id: parseInt(updated.id, 10),
      name: updated.name,
      percentage: parseInt(updated.percentage, 10),
      user_id: updated.user_id ? parseInt(updated.user_id, 10) : null,
      family_id: updated.family_id ? parseInt(updated.family_id, 10) : null
    });
  } catch (error) {
    if (error instanceof categoriesService.NotFoundError) {
      return res.status(404)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/not-found',
          title: 'Categoría no encontrada',
          status: 404,
          detail: error.message,
          instance: `/api/categories/${req.params.id}`
        });
    }

    if (error instanceof categoriesService.ValidationError) {
      return res.status(422)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/validation-error',
          title: 'Error de validación de entidad',
          status: 422,
          detail: error.message,
          instance: `/api/categories/${req.params.id}`,
          invalid_params: error.invalid_params
        });
    }

    if (error instanceof categoriesService.ConflictError) {
      return res.status(409)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/conflict',
          title: 'Conflicto por nombre de categoría duplicado',
          status: 409,
          detail: error.message,
          instance: `/api/categories/${req.params.id}`
        });
    }

    console.error('Error updating category:', error);
    return res.status(500)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/internal-server-error',
        title: 'Error interno del servidor',
        status: 500,
        detail: 'Ocurrió un error inesperado al actualizar la categoría',
        instance: `/api/categories/${req.params.id}`
      });
  }
}

/**
 * DELETE /api/categories/:id
 * Contract: CAT-005
 */
async function deleteCategory(req, res) {
  const paramParse = categoryIdParamSchema.safeParse(req.params);

  if (!paramParse.success) {
    return res.status(422)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/validation-error',
        title: 'Error de validación de identificador',
        status: 422,
        detail: 'El parámetro :id debe ser un entero positivo',
        instance: `/api/categories/${req.params.id}`,
        invalid_params: [{ name: 'id', reason: 'Debe ser un número entero positivo' }]
      });
  }

  try {
    const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : (req.body?.user_id ? parseInt(req.body.user_id, 10) : null);
    await categoriesService.deleteCategory(paramParse.data.id, userId);
    return res.status(204).send();
  } catch (error) {
    if (error instanceof categoriesService.ValidationError) {
      return res.status(422)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/validation-error',
          title: 'Error de validación de entidad',
          status: 422,
          detail: error.message,
          instance: `/api/categories/${req.params.id}`,
          invalid_params: error.invalid_params
        });
    }

    if (error instanceof categoriesService.NotFoundError) {
      return res.status(404)
        .contentType('application/problem+json')
        .json({
          type: 'https://api.finances.local/errors/not-found',
          title: 'Categoría no encontrada',
          status: 404,
          detail: error.message,
          instance: `/api/categories/${req.params.id}`
        });
    }

    console.error('Error deleting category:', error);
    return res.status(500)
      .contentType('application/problem+json')
      .json({
        type: 'https://api.finances.local/errors/internal-server-error',
        title: 'Error interno del servidor',
        status: 500,
        detail: 'Ocurrió un error inesperado al eliminar la categoría',
        instance: `/api/categories/${req.params.id}`
      });
  }
}

module.exports = {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory
};
