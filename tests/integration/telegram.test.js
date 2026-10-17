const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/index');
const db = require('../../src/shared/database/db');

let server;
const PORT = 3096;
let testUserId = null;
let foreignUserId = null;
let generatedToken = null;

function makeToken(userId, email = 'user@example.com') {
  return Buffer.from(`${userId}:${Date.now()}:${email}`).toString('base64');
}

before(async () => {
  await db.checkDatabaseConnection();
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  // [TEST DATA FIXTURE] Isolated test user
  const userRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('TelegramTest', 'User', 'telegram.test.${Date.now()}@example.com')
    RETURNING id;
  `);
  testUserId = parseInt(userRes.rows[0].id, 10);

  // [TEST DATA FIXTURE] Foreign user without linked telegram
  const foreignUserRes = await db.query(`
    INSERT INTO finances.users (first_name, last_name, email)
    VALUES ('ForeignTg', 'User', 'foreign.tg.${Date.now()}@example.com')
    RETURNING id;
  `);
  foreignUserId = parseInt(foreignUserRes.rows[0].id, 10);
});

after(async () => {
  if (testUserId) {
    await db.query('DELETE FROM finances.telegram WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.outcome WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.cashflow WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.goals WHERE user_id = $1;', [testUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [testUserId]);
  }
  if (foreignUserId) {
    await db.query('DELETE FROM finances.telegram WHERE user_id = $1;', [foreignUserId]);
    await db.query('DELETE FROM finances.users WHERE id = $1;', [foreignUserId]);
  }
  await new Promise((resolve) => server.close(resolve));
});

describe('US-012 Telegram Account Link & Notifications Integration Tests', () => {

  test('TEL-001: POST /api/telegram/generate-token generates secure token & deepLink (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/generate-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({ userId: testUserId })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.userId, testUserId);
    assert.ok(body.token);
    assert.ok(body.token.startsWith('tg_link_'));
    generatedToken = body.token;
    assert.ok(body.deepLink);
    assert.ok(body.deepLink.includes(body.token));
    assert.ok(body.botUsername);
  });

  test('TEL-003: GET /api/telegram/status reports linked: false initially (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/status?userId=${testUserId}`, {
      headers: {
        'Authorization': `Bearer ${makeToken(testUserId)}`
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.linked, false);
    assert.equal(body.chatIdMasked, null);
  });

  test('TEL-002: POST /api/telegram/link rejects invalid or negative chatId with 422', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        userId: testUserId,
        chatId: -500
      })
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'chatId'));
  });

  test('TEL-002: POST /api/telegram/link links chatId successfully (201)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        userId: testUserId,
        chatId: 5839201948,
        token: generatedToken
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.equal(body.userId, testUserId);
    assert.equal(body.chatId, 5839201948);
    assert.equal(body.linked, true);
  });

  test('TEL-003: GET /api/telegram/status reports linked: true with masked chatId (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/status?userId=${testUserId}`, {
      headers: {
        'Authorization': `Bearer ${makeToken(testUserId)}`
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.linked, true);
    assert.equal(body.userId, testUserId);
    assert.ok(body.chatIdMasked.includes('***'));
    assert.equal(body.chatIdMasked, '5839***948');
  });

  test('TEL-004: POST /api/telegram/test-notification dispatches/simulates message (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/test-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        userId: testUserId,
        message: 'Mensaje de prueba de integración'
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sent, true);
    assert.ok(body.mode === 'real' || body.mode === 'simulated');
    assert.equal(body.recipientChatId, 5839201948);
  });

  test('TEL-004: POST /api/telegram/test-notification returns 404 for unlinked user', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/test-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(foreignUserId)}`
      },
      body: JSON.stringify({
        userId: foreignUserId,
        message: 'Prueba no autorizada'
      })
    });

    assert.equal(res.status, 404);
  });

  test('TEL-005: DELETE /api/telegram/link unlinks telegram account successfully (204)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/link?userId=${testUserId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${makeToken(testUserId)}`
      }
    });

    assert.equal(res.status, 204);

    // Verify status returns linked: false
    const statusRes = await fetch(`http://localhost:${PORT}/api/telegram/status?userId=${testUserId}`, {
      headers: {
        'Authorization': `Bearer ${makeToken(testUserId)}`
      }
    });
    const statusBody = await statusRes.json();
    assert.equal(statusBody.linked, false);
  });

  test('TEL-005: DELETE /api/telegram/link returns 404 when unlinking already unlinked user', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/link?userId=${testUserId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${makeToken(testUserId)}`
      }
    });

    assert.equal(res.status, 404);
  });

});

describe('US-013 Telegram Interactive Bot & Webhook Integration Tests', () => {
  const linkedChatId = 5839201948;

  before(async () => {
    // Re-link test user for US-013 suite
    await db.query(`
      INSERT INTO finances.telegram (user_id, chat_id, token, updated_at)
      VALUES ($1, $2, 'tg_link_us013_active', CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, updated_at = CURRENT_TIMESTAMP;
    `, [testUserId, linkedChatId]);
  });

  test('BOT-001: POST /api/telegram/webhook returns friendly rejection for unlinked chat_id (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 20001,
        message: {
          message_id: 101,
          chat: { id: 999999999 },
          text: '/balance'
        }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.processed, true);
    assert.ok(body.reply.includes('no está vinculada'));
  });

  test('BOT-001: POST /api/telegram/webhook rejects malformed payload with 422 ProblemDetails', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { chat: { id: linkedChatId }, text: 'Hola' }
      })
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
    assert.ok(problem.invalid_params.some(p => p.name === 'update_id'));
  });

  test('BOT-001: POST /api/telegram/webhook processes /ayuda command (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 20002,
        message: {
          message_id: 102,
          chat: { id: linkedChatId },
          text: '/ayuda'
        }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.processed, true);
    assert.equal(body.command, '/ayuda');
    assert.ok(body.reply.includes('Comandos Disponibles'));
    assert.ok(body.reply.includes('/gasto'));
    assert.ok(body.reply.includes('/ingreso'));
    assert.ok(body.reply.includes('/balance'));
  });

  test('BOT-001: POST /api/telegram/webhook processes /gasto command and inserts into database (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 20003,
        message: {
          message_id: 103,
          chat: { id: linkedChatId },
          text: '/gasto 35000 Almuerzo ejecutivo'
        }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.processed, true);
    assert.equal(body.command, '/gasto');
    assert.ok(body.reply.includes('Gasto registrado exitosamente'));
    assert.ok(body.reply.includes('$35.000') || body.reply.includes('35.000'));
    assert.ok(body.action);
    assert.equal(body.action.type, 'expense');
    assert.equal(body.action.amount, 35000);

    // Verify record in database finances.outcome
    const dbCheck = await db.query(
      'SELECT id, incomeamount::float as amount FROM finances.outcome WHERE id = $1;',
      [body.action.recordId]
    );
    assert.equal(dbCheck.rows[0].amount, 35000);
  });

  test('BOT-001: POST /api/telegram/webhook rejects invalid /gasto syntax with friendly message (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 20004,
        message: {
          message_id: 104,
          chat: { id: linkedChatId },
          text: '/gasto abc'
        }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.processed, true);
    assert.ok(body.reply.includes('Formato de gasto incorrecto'));
  });

  test('BOT-001: POST /api/telegram/webhook processes /ingreso command and inserts into database (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 20005,
        message: {
          message_id: 105,
          chat: { id: linkedChatId },
          text: '/ingreso 150000 Pago bono consultoría'
        }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.processed, true);
    assert.equal(body.command, '/ingreso');
    assert.ok(body.reply.includes('Ingreso registrado exitosamente'));
    assert.ok(body.action);
    assert.equal(body.action.type, 'income');
    assert.equal(body.action.amount, 150000);

    // Verify record in finances.cashflow
    const dbCheck = await db.query(
      'SELECT id, incomeamount::float as amount FROM finances.cashflow WHERE id = $1;',
      [body.action.recordId]
    );
    assert.equal(dbCheck.rows[0].amount, 150000);
  });

  test('BOT-001: POST /api/telegram/webhook calculates /balance monthly totals (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 20006,
        message: {
          message_id: 106,
          chat: { id: linkedChatId },
          text: '/balance'
        }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.processed, true);
    assert.equal(body.command, '/balance');
    assert.ok(body.reply.includes('Resumen Financiero del Mes'));
    assert.ok(body.reply.includes('Ingresos'));
    assert.ok(body.reply.includes('Gastos'));
    assert.ok(body.reply.includes('Balance Neto'));
    assert.equal(body.action.type, 'balance');
  });

  test('BOT-001: POST /api/telegram/webhook handles /metas command (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 20007,
        message: {
          message_id: 107,
          chat: { id: linkedChatId },
          text: '/metas'
        }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.processed, true);
    assert.equal(body.command, '/metas');
    assert.ok(body.reply.includes('Metas Financieras') || body.reply.includes('No tienes metas'));
  });

  test('BOT-002: POST /api/telegram/chat-simulate processes message in sandbox mode (200)', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/chat-simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        userId: testUserId,
        message: '/ayuda'
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.processed, true);
    assert.equal(body.command, '/ayuda');
    assert.ok(body.reply.includes('Comandos Disponibles'));
  });

  test('BOT-002: POST /api/telegram/chat-simulate rejects empty message with 422 ProblemDetails', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/telegram/chat-simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeToken(testUserId)}`
      },
      body: JSON.stringify({
        userId: testUserId,
        message: ''
      })
    });

    assert.equal(res.status, 422);
    const problem = await res.json();
    assert.equal(problem.status, 422);
  });

});
