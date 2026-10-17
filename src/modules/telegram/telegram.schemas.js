const { z } = require('zod');

function normalizeTelegramKeys(obj) {
  if (obj && typeof obj === 'object') {
    const copy = { ...obj };

    if (copy.user_id !== undefined && copy.userId === undefined) {
      copy.userId = copy.user_id;
      delete copy.user_id;
    }

    if (copy.chat_id !== undefined && copy.chatId === undefined) {
      copy.chatId = copy.chat_id;
      delete copy.chat_id;
    }

    return copy;
  }
  return obj;
}

const generateTokenSchema = z.preprocess(normalizeTelegramKeys, z.object({
  userId: z.coerce.number({
    invalid_type_error: 'userId debe ser un número entero'
  }).int('userId debe ser un entero').positive('userId debe ser positivo').optional()
}));

const linkTelegramSchema = z.preprocess(normalizeTelegramKeys, z.object({
  userId: z.coerce.number({
    invalid_type_error: 'userId debe ser un número entero'
  }).int('userId debe ser un entero').positive('userId debe ser positivo').optional(),

  chatId: z.coerce.number({
    required_error: 'chatId es requerido',
    invalid_type_error: 'chatId debe ser un número entero'
  }).int('chatId debe ser un entero').positive('chatId debe ser un entero positivo'),

  token: z.string({
    invalid_type_error: 'token debe ser una cadena de texto'
  }).trim().min(8, 'token debe contener al menos 8 caracteres').max(128, 'token no debe exceder 128 caracteres').optional()
}));

const statusQuerySchema = z.preprocess(normalizeTelegramKeys, z.object({
  userId: z.coerce.number({
    invalid_type_error: 'userId debe ser un número entero'
  }).int('userId debe ser un entero').positive('userId debe ser positivo').optional()
}));

const testNotificationSchema = z.preprocess(normalizeTelegramKeys, z.object({
  userId: z.coerce.number({
    invalid_type_error: 'userId debe ser un número entero'
  }).int('userId debe ser un entero').positive('userId debe ser positivo').optional(),

  message: z.string({
    invalid_type_error: 'message debe ser una cadena de texto'
  }).trim().max(500, 'message no debe exceder 500 caracteres').optional()
}));

const webhookSchema = z.object({
  update_id: z.coerce.number({
    required_error: 'update_id es requerido',
    invalid_type_error: 'update_id debe ser un número entero'
  }).int('update_id debe ser un entero'),

  message: z.object({
    message_id: z.coerce.number().optional(),
    chat: z.object({
      id: z.coerce.number({
        required_error: 'chat.id es requerido',
        invalid_type_error: 'chat.id debe ser un número entero'
      })
    }),
    text: z.string().max(1000).optional()
  }).optional()
});

const chatSimulateSchema = z.object({
  userId: z.coerce.number({
    invalid_type_error: 'userId debe ser un número entero'
  }).int('userId debe ser un entero').positive('userId debe ser positivo').optional(),

  message: z.string({
    required_error: 'message es requerido',
    invalid_type_error: 'message debe ser una cadena de texto'
  }).trim().min(1, 'message no debe estar vacío').max(1000, 'message no debe exceder 1000 caracteres')
});

module.exports = {
  generateTokenSchema,
  linkTelegramSchema,
  statusQuerySchema,
  testNotificationSchema,
  webhookSchema,
  chatSimulateSchema
};
