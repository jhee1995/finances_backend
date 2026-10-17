const express = require('express');
const goalsController = require('./goals.controller');

const router = express.Router();

router.post('/', goalsController.create);
router.get('/', goalsController.list);
router.get('/:id', goalsController.getById);
router.put('/:id', goalsController.update);
router.delete('/:id', goalsController.remove);

module.exports = router;
