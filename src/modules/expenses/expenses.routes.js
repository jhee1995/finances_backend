const express = require('express');
const controller = require('./expenses.controller');

const router = express.Router();

// Contract: EXP-001 (POST /api/expenses)
router.post('/', controller.create);

// Contract: EXP-002 (GET /api/expenses)
router.get('/', controller.list);

// Contract: EXP-003 (GET /api/expenses/:id)
router.get('/:id', controller.getById);

// Contract: EXP-004 (PUT /api/expenses/:id)
router.put('/:id', controller.update);

// Contract: EXP-005 (DELETE /api/expenses/:id)
router.delete('/:id', controller.remove);

module.exports = router;
