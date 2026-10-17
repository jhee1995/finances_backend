const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

// Load environment from backend/.env if not already set
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // PostgreSQL Connection
  POSTGRES_HOST: z.string().default('db.brexizevnnkcvdoazzfk.supabase.co'),
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_PASSWORD: z.string().default('1yWMSNKXZV3FVFbQ'),
  POSTGRES_DATABASE: z.string().default('postgres'),
  POSTGRES_PORT: z.string().default('5432').transform((val) => parseInt(val, 10)),

  // Supabase URLs & Keys
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),

  // Telegram Integration
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().default('FinanzasManagerBot')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables in backend/.env:', parsed.error.format());
  throw new Error('Environment configuration error');
}

module.exports = {
  config: parsed.data
};
