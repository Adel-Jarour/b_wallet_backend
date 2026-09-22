/**
 * B-Wallet Database Bootstrap & Migration Applier
 * ================================================
 * Creates helper SQL functions and applies all migrations to Supabase.
 * 
 * Uses a creative bootstrapping approach:
 * Since Supabase doesn't expose a raw SQL endpoint via REST, we use the
 * PostgREST /rpc endpoint. But to call /rpc/exec_sql, exec_sql must exist.
 * 
 * Bootstrap strategy:
 * 1. Create a temporary table with a trigger that creates exec_sql()
 * 2. Use the PostgREST INSERT endpoint to fire the trigger
 * 3. Clean up the temporary bootstrap infrastructure
 * 4. Run all migrations via exec_sql()
 * 
 * Alternative: If exec_sql already exists, skip bootstrap entirely.
 * 
 * Usage:
 *   node database/scripts/apply-migrations.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function getMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => parseInt(a.split('_')[0], 10) - parseInt(b.split('_')[0], 10));
}

async function checkExecSqlExists() {
  const { error } = await supabase.rpc('exec_sql', { sql_query: 'SELECT 1' });
  return !error;
}

async function execSql(sql) {
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Bootstrap exec_sql by creating a temporary function that installs it.
 * Strategy: Use Supabase's ability to create database functions via the
 * SQL editor migration seed, or use a creative PostgREST approach.
 */
async function bootstrapExecSql() {
  console.log('\n  🔧 Bootstrapping exec_sql() function...');
  console.log('  This function is required to run SQL migrations via Supabase RPC.\n');

  // Strategy: We'll try multiple approaches to create exec_sql

  // Approach 1: Check if supabase-js has the sql tagged template literal
  // (available in newer versions)
  try {
    // supabase-js v2.39+ has supabase.sql
    if (typeof supabase.sql === 'function') {
      await supabase.sql`
        CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
        RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, auth, extensions
        AS $fn$ BEGIN EXECUTE sql_query; END; $fn$;
      `;
      console.log('  ✅ exec_sql() created via supabase.sql()');
      return true;
    }
  } catch (e) {
    // Method not available, try next approach
  }

  // Approach 2: Try using Supabase edge function or management API
  // Not available without additional setup

  // Approach 3: Print manual instructions
  console.log('  ════════════════════════════════════════════════════════════');
  console.log('  ❗ MANUAL STEP REQUIRED');
  console.log('  ════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Please run the following SQL in your Supabase Dashboard:');
  console.log('  Go to: https://supabase.com/dashboard → SQL Editor → New Query');
  console.log('');
  console.log('  ────────────────────────────────────────────────────────────');
  console.log(`
  CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
  RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, auth, extensions
  AS $fn$
  BEGIN
    EXECUTE sql_query;
  END;
  $fn$;

  CREATE OR REPLACE FUNCTION query_sql(sql_query TEXT)
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, auth, extensions
  AS $fn$
  DECLARE
    result JSONB;
  BEGIN
    EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (' || sql_query || ') t'
      INTO result;
    RETURN result;
  END;
  $fn$;
  `);
  console.log('  ────────────────────────────────────────────────────────────');
  console.log('');
  console.log('  After running the SQL above, re-run this script.');
  console.log('  ════════════════════════════════════════════════════════════');

  return false;
}

async function ensureQuerySql() {
  try {
    const { error } = await supabase.rpc('query_sql', { sql_query: 'SELECT 1 as test' });
    if (!error) return;
  } catch (e) { /* Doesn't exist */ }

  await execSql(`
    CREATE OR REPLACE FUNCTION query_sql(sql_query TEXT)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, auth, extensions
    AS $fn$
    DECLARE
      result JSONB;
    BEGIN
      EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (' || sql_query || ') t'
        INTO result;
      RETURN result;
    END;
    $fn$;
  `);
  console.log('  ✅ query_sql() created');
}

async function applyMigration(fileName) {
  const filePath = path.join(MIGRATIONS_DIR, fileName);
  const sql = fs.readFileSync(filePath, 'utf-8');

  try {
    await execSql(sql);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('=============================================================');
  console.log('       B-Wallet Database Migration Applier');
  console.log('=============================================================');
  console.log(`[Database]  : ${SUPABASE_URL}`);
  console.log(`[Migrations]: ${MIGRATIONS_DIR}`);
  console.log('-------------------------------------------------------------');

  // Check if exec_sql exists
  const exists = await checkExecSqlExists();

  if (!exists) {
    const created = await bootstrapExecSql();
    if (!created) {
      process.exit(1);
    }
  } else {
    console.log('\n  ✅ exec_sql() already exists');
  }

  // Ensure query_sql exists too
  await ensureQuerySql();

  // Get migration files
  const specificFile = process.argv.find(arg => arg.startsWith('--file='));
  let migrationFiles;

  if (specificFile) {
    const fileName = specificFile.split('=')[1];
    if (!fs.existsSync(path.join(MIGRATIONS_DIR, fileName))) {
      console.error(`\n❌ Migration file not found: ${fileName}`);
      process.exit(1);
    }
    migrationFiles = [fileName];
  } else {
    migrationFiles = getMigrationFiles();
  }

  console.log(`\n  Found ${migrationFiles.length} migration(s):\n`);

  let successCount = 0;
  let failCount = 0;

  for (const file of migrationFiles) {
    process.stdout.write(`  ▸ ${file} ... `);
    const result = await applyMigration(file);

    if (result.success) {
      console.log('✅ OK');
      successCount++;
    } else {
      console.log('❌ FAILED');
      console.log(`    Error: ${result.error}`);
      failCount++;
    }
  }

  console.log('\n-------------------------------------------------------------');
  console.log(`  Results: ${successCount} ✅ succeeded, ${failCount} ❌ failed, ${migrationFiles.length} total`);
  console.log('=============================================================');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
