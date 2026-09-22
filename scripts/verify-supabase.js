/**
 * Standalone Supabase Connection Verification Script for B-Wallet
 * Run via: npm run verify:supabase
 */
const { env } = require('../src/config/env');
const { checkSupabaseHealth } = require('../src/config/supabase');

async function runVerification() {
  console.log('=====================================================');
  console.log('       B-Wallet Supabase Connectivity Diagnostic     ');
  console.log('=====================================================');
  console.log(`[Target URL] : ${env.SUPABASE_URL}`);
  console.log(`[Service Key]: ${env.SUPABASE_SERVICE_ROLE_KEY ? '***' + env.SUPABASE_SERVICE_ROLE_KEY.slice(-6) : 'NOT SET'}`);
  console.log(`[Environment]: ${env.NODE_ENV}`);
  console.log('-----------------------------------------------------');
  console.log('Testing connection to Supabase API...\n');

  const health = await checkSupabaseHealth();

  if (health.healthy) {
    console.log('✅ STATUS: CONNECTED');
    console.log(`⏱️  Latency: ${health.latencyMs}ms`);
    console.log('🎉 Supabase Auth Admin API reachable with provided service_role key!');
    console.log('Your empty Supabase project is ready for Sprint 1 schema migrations.');
    process.exit(0);
  } else {
    console.log('❌ STATUS: DISCONNECTED');
    console.log(`⏱️  Latency: ${health.latencyMs}ms`);
    console.log(`⚠️  Error Details: ${health.error}`);
    console.log('\nTroubleshooting Tips:');
    console.log('1. Open your Supabase project dashboard -> Settings -> API.');
    console.log('2. Copy Project URL into SUPABASE_URL in .env.');
    console.log('3. Copy secret "service_role" key into SUPABASE_SERVICE_ROLE_KEY in .env.');
    console.log('4. Ensure your internet connection is active.');
    process.exit(1);
  }
}

runVerification();
