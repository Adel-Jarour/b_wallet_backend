const { createClient } = require('@supabase/supabase-js');
const { env } = require('./env');
const logger = require('./logger');

let supabaseAdmin = null;

try {
  supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
} catch (error) {
  logger.error({ error: error.message }, 'Failed to instantiate Supabase client');
}

/**
 * Verifies live connection to the Supabase backend.
 * Works even on an empty database by querying Supabase Auth Admin or Storage.
 *
 * @returns {Promise<{ healthy: boolean, latencyMs: number, details?: any, error?: string }>}
 */
async function checkSupabaseHealth() {
  if (!supabaseAdmin) {
    return {
      healthy: false,
      latencyMs: 0,
      error: 'Supabase client is not instantiated'
    };
  }

  const startTime = Date.now();
  const timeoutMs = 3000;
  const timeoutPromise = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Supabase connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  try {
    // Ping Supabase Auth Admin API (works on empty projects with service_role key)
    const { data, error } = await Promise.race([
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 }),
      timeoutPromise
    ]);

    const latencyMs = Date.now() - startTime;

    if (error) {
      return {
        healthy: false,
        latencyMs,
        error: error.message
      };
    }

    return {
      healthy: true,
      latencyMs,
      details: {
        usersAccessible: true,
        projectUrl: env.SUPABASE_URL
      }
    };
  } catch (err) {
    return {
      healthy: false,
      latencyMs: Date.now() - startTime,
      error: err.message
    };
  }
}

module.exports = {
  supabaseAdmin,
  checkSupabaseHealth
};
