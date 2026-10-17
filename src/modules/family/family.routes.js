const express = require('express');
const router = express.Router();
const familyController = require('./family.controller');

// FAM-001: Create family core
router.post('/', familyController.create);

// FAM-003: Get family status by user ID (defined before /:id to prevent route clash)
router.get('/user/:userId', familyController.getByUserId);

// FAM-006: Get family financial summary (defined before /:id generic param)
router.get('/:id/summary', familyController.getSummary);

// FAM-002: Get family details and members by ID
router.get('/:id', familyController.getById);

// FAM-004: Add member to family
router.post('/:id/members', familyController.addMember);

// FAM-005: Remove member from family
router.delete('/:id/members/:userId', familyController.removeMember);

module.exports = router;
