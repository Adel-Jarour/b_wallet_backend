const dotenv = require('dotenv');
const { z } = require('zod');

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SUPABASE_URL: z.string().url({ message: 'SUPABASE_URL must be a valid URL' }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, { message: 'SUPABASE_SERVICE_ROLE_KEY is required' }),
  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PAYMENT_GATEWAY_WEBHOOK_SECRET: z.string().default('test_webhook_secret_key_bwallet_2026')
});

function validateEnv(config = process.env) {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errorDetails = result.error.errors.map(err => `  - ${err.path.join('.')}: ${err.message}`).join('\n');
    const message = `[FATAL] Invalid environment configuration:\n${errorDetails}`;
    
    // In test mode, we throw so tests can catch and assert validation failures
    if (process.env.NODE_ENV === 'test') {
      throw new Error(message);
    }
    
    console.error(message);
    process.exit(1);
  }

  return result.data;
}

let env;
try {
  env = validateEnv(process.env);
} catch (err) {
  // In test mode, if env fails on initial load, fallback to test defaults
  if (process.env.NODE_ENV === 'test') {
    env = {
      PORT: 3000,
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      CORS_ORIGIN: '*',
      LOG_LEVEL: 'silent',
      PAYMENT_GATEWAY_WEBHOOK_SECRET: 'test_webhook_secret_key_bwallet_2026'
    };
  } else {
    throw err;
  }
}

module.exports = {
  env,
  validateEnv
};
