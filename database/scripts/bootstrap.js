/**
 * Bootstrap: Create exec_sql helper function in Supabase
 * ======================================================
 * This script creates the exec_sql() and query_sql() PostgreSQL functions
 * that allow the migration runner and tests to execute arbitrary SQL
 * via Supabase RPC.
 *
 * Must be run once before the first migration.
 * Usage: node database/scripts/bootstrap.js
 */

require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

async function bootstrap() {
  console.log('=============================================================');
  console.log('       B-Wallet Database Bootstrap');
  console.log('=============================================================');
  console.log(`[Database]: ${SUPABASE_URL}`);
  console.log('-------------------------------------------------------------');

  // Use the Supabase SQL endpoint to create our helper functions
  // The /pg/query endpoint allows running arbitrary SQL with the service role key
  const sqlStatements = [
    // exec_sql: Execute arbitrary SQL (no return value)
    `CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
     RETURNS VOID
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = public, auth, extensions
     AS $fn$
     BEGIN
       EXECUTE sql_query;
     END;
     $fn$;`,

    // query_sql: Execute SQL and return results as JSONB
    `CREATE OR REPLACE FUNCTION query_sql(sql_query TEXT)
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
     $fn$;`
  ];

  for (let i = 0; i < sqlStatements.length; i++) {
    const sql = sqlStatements[i];
    const fnName = i === 0 ? 'exec_sql' : 'query_sql';

    console.log(`\n  ▸ Creating ${fnName}() function...`);

    try {
      // Try using the Supabase REST /sql endpoint
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ sql_query: sql })
      });

      if (response.ok || response.status === 204) {
        console.log(`    ✅ ${fnName}() created successfully`);
        continue;
      }

      // If exec_sql doesn't exist yet, we can't use it to create itself
      // Try using the pg endpoint instead
      if (response.status === 404 || response.status === 400) {
        // First function: we need an alternative approach
        // Use the Supabase query endpoint
        const pgResponse = await fetch(`${SUPABASE_URL}/rest/v1/`, {
          method: 'GET',
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          }
        });

        // If REST API is reachable, try creating via a temporary approach
        // We'll use the supabase-js client directly
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
          db: { schema: 'public' }
        });

        // Try executing via the schema cache endpoint or a raw query
        // Supabase JS v2 doesn't support raw SQL, so we need another approach
        console.log(`    ⚠️  Cannot create ${fnName}() via RPC (function doesn't exist yet).`);
        console.log(`    ℹ️  Please run the following SQL in your Supabase Dashboard SQL Editor:`);
        console.log('    ────────────────────────────────────────────────');
        console.log(`    ${sql.replace(/\n/g, '\n    ')}`);
        console.log('    ────────────────────────────────────────────────');

        if (i === 0) {
          console.log('\n  ❗ After running the SQL above, re-run this bootstrap script.');
          process.exit(1);
        }
      } else {
        const text = await response.text();
        console.log(`    ❌ Failed: ${response.status} ${text}`);
      }
    } catch (err) {
      console.log(`    ❌ Error: ${err.message}`);
    }
  }

  console.log('\n-------------------------------------------------------------');
  console.log('✅ Bootstrap complete. You can now run: npm run migrate');
  console.log('=============================================================');
}

bootstrap().catch(err => {
  console.error('Fatal bootstrap error:', err.message);
  process.exit(1);
});
