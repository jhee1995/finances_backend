const express = require('express');
const router = express.Router();
const paymentPlansController = require('./payment_plans.controller');

// PLN-001: Compare 5 repayment strategies
router.post('/compare', paymentPlansController.comparePlans);

// PLN-002: Save or update selected plan
router.post('/', paymentPlansController.savePlan);

// PLN-003: Get active plan and progress
router.get('/active', paymentPlansController.getActivePlan);

module.exports = router;
