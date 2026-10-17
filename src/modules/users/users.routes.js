const express = require('express');
const usersController = require('./users.controller');

const router = express.Router();

// Contract: USR-001 (POST /api/users)
router.post('/', usersController.createUser);

// Contract: USR-002 (GET /api/users/:id)
router.get('/:id', usersController.getUserById);

// Contract: USR-003 (GET /api/users)
router.get('/', usersController.listUsers);

// Contract: USR-004 (PUT /api/users/:id)
router.put('/:id', usersController.updateUser);

module.exports = router;
