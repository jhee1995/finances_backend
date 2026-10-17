const express = require('express');
const controller = require('./recurring_obligations.controller');

const router = express.Router();

// REC-003: Consultar estado y checklist del ciclo mensual o quincenal (Debe ir antes de /:id)
router.get('/period-status', controller.getPeriodStatus);

// REC-001: Registrar nueva obligación periódica
router.post('/', controller.create);

// REC-002: Listar obligaciones periódicas
router.get('/', controller.list);

// REC-004: Registrar pago rápido de obligación y generar egreso atómico
router.post('/:id/pay', controller.pay);

// REC-005: Desactivar o eliminar obligación
router.delete('/:id', controller.remove);

module.exports = router;
