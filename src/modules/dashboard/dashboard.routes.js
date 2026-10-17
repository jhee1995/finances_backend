const express = require('express');
const controller = require('./dashboard.controller');

const router = express.Router();

// Contract: DSH-001 (GET /api/dashboard/summary)
router.get('/summary', controller.getSummary);

module.exports = router;
