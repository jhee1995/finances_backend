const express = require('express');
const {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory
} = require('./categories.controller');

const router = express.Router();

// Contract: CAT-001 - POST /api/categories
router.post('/', createCategory);

// Contract: CAT-002 - GET /api/categories
router.get('/', getCategories);

// Contract: CAT-003 - GET /api/categories/:id
router.get('/:id', getCategoryById);

// Contract: CAT-004 - PUT /api/categories/:id
router.put('/:id', updateCategory);

// Contract: CAT-005 - DELETE /api/categories/:id
router.delete('/:id', deleteCategory);

module.exports = router;
