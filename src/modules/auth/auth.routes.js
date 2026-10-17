const express = require('express');
const { login, register } = require('./auth.controller');

const router = express.Router();

// Contract: AUTH-001 - POST /api/auth/login
router.post('/login', login);

// Contract: AUTH-002 - POST /api/auth/register
router.post('/register', register);

module.exports = router;
