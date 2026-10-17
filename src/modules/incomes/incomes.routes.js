const express = require('express');
const controller = require('./incomes.controller');

const router = express.Router();

// Contract: INC-001 (POST /api/incomes)
router.post('/', controller.create);

// Contract: INC-002 (GET /api/incomes)
router.get('/', controller.list);

// Contract: INC-003 (GET /api/incomes/:id)
router.get('/:id', controller.getById);

// Contract: INC-004 (PUT /api/incomes/:id)
router.put('/:id', controller.update);

// Contract: INC-005 (DELETE /api/incomes/:id)
router.delete('/:id', controller.remove);

module.exports = router;
