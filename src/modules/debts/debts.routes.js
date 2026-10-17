const express = require('express');
const debtsController = require('./debts.controller');

const router = express.Router();

// DEB-006: Simulate debt amortization (US-009)
router.post('/simulate', debtsController.simulate);

// DEB-007 & DEB-008: Debt Payments (US-019)
router.post('/:id/payments', debtsController.createPayment);
router.get('/:id/payments', debtsController.listPayments);

router.post('/', debtsController.create);
router.get('/', debtsController.list);
router.get('/:id', debtsController.getById);
router.put('/:id', debtsController.update);
router.delete('/:id', debtsController.remove);

module.exports = router;
