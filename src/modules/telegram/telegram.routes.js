const express = require('express');
const telegramController = require('./telegram.controller');

const router = express.Router();

router.post('/generate-token', telegramController.generateToken);
router.post('/link', telegramController.link);
router.get('/status', telegramController.getStatus);
router.post('/test-notification', telegramController.testNotification);
router.delete('/link', telegramController.unlink);
router.post('/webhook', telegramController.handleWebhook);
router.post('/chat-simulate', telegramController.simulateChat);

module.exports = router;
