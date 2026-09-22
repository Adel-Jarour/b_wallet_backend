/**
 * B-Wallet Database Migration Runner
 * ===================================
 * Reads SQL migration files from database/migrations/ in numeric order
 * and executes each against the Supabase PostgreSQL database using the
 * service_role admin client.
 *
 * Usage:
 *   npm run migrate
 *   node database/scripts/migrate.js
 *   node database/scripts/migrate.js --file 001_extensions_and_types.sql
 */

const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../../src/config/supabase');
const logger = require('../../src/config/logger');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Reads and sorts all .sql files from the migrations directory.
 * @returns {string[]} Sorted list of migration file names
 */
function getMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => {
      const numA = parseInt(a.split('_')[0], 10);
      const numB = parseInt(b.split('_')[0], 10);
      return numA - numB;
    });
  return files;
}

/**
 * Executes a single SQL migration file against the Supabase database.
 * @param {string} fileName - Name of the SQL file to execute
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function executeMigration(fileName) {
  const filePath = path.join(MIGRATIONS_DIR, fileName);
  const sql = fs.readFileSync(filePath, 'utf-8');

  try {
    // Execute raw SQL via Supabase's rpc or direct pg call
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: sql });

    if (error) {
      // If the exec_sql function doesn't exist, try using the REST API
      // by executing via the postgres endpoint
      throw new Error(error.message);
    }

    return { success: true };
  } catch (rpcError) {
    // Fallback: execute SQL directly using fetch to the Supabase SQL endpoint
    try {
      const response = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ sql_query: sql })
        }
      );

      if (!response.ok) {
        // Final fallback: use the Supabase SQL Management API
        return await executeMigrationViaSqlApi(sql, fileName);
      }

      return { success: true };
    } catch (fetchError) {
      return await executeMigrationViaSqlApi(sql, fileName);
    }
  }
}

/**
 * Executes SQL via the Supabase Management API /query endpoint.
 * This is the most reliable method for running arbitrary DDL statements.
 * @param {string} sql - SQL to execute
 * @param {string} fileName - Migration file name for logging
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function executeMigrationViaSqlApi(sql, fileName) {
  try {
    // Extract project reference from SUPABASE_URL
    const urlMatch = process.env.SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (!urlMatch) {
      throw new Error('Could not extract project reference from SUPABASE_URL');
    }

    // Use the pg connection via supabaseAdmin's underlying capabilities
    // Execute the SQL in chunks if needed (Supabase REST limitation)
    const { data, error } = await supabaseAdmin.from('_migrations_check').select('*').limit(0).catch(() => ({}));

    // Since direct SQL execution via REST is limited, we'll use the
    // supabase-js sql tagged template if available, or fall back to
    // executing individual statements
    const statements = splitSqlStatements(sql);

    for (const stmt of statements) {
      if (!stmt.trim()) continue;

      const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: stmt });
      if (error) {
        return { success: false, error: `${fileName}: ${error.message}` };
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `${fileName}: ${err.message}` };
  }
}

/**
 * Splits a SQL file into individual statements, handling
 * dollar-quoted function bodies correctly.
 * @param {string} sql - Raw SQL content
 * @returns {string[]} Array of individual SQL statements
 */
function splitSqlStatements(sql) {
  // Remove SQL comments (lines starting with --)
  const lines = sql.split('\n');
  const cleanedLines = [];
  let inDollarQuote = false;
  let dollarTag = '';

  for (const line of lines) {
    // Track dollar-quoted strings (function bodies)
    const dollarMatches = line.match(/\$[^$]*\$/g);
    if (dollarMatches) {
      for (const match of dollarMatches) {
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarTag = match;
        } else if (match === dollarTag) {
          inDollarQuote = false;
          dollarTag = '';
        }
      }
    }

    // Keep comments inside dollar-quoted strings (function bodies)
    if (inDollarQuote || !line.trim().startsWith('--')) {
      cleanedLines.push(line);
    }
  }

  // Rejoin and split on semicolons, but not those inside dollar-quoted strings
  const fullSql = cleanedLines.join('\n');
  const statements = [];
  let current = '';
  inDollarQuote = false;
  dollarTag = '';

  for (let i = 0; i < fullSql.length; i++) {
    const char = fullSql[i];

    // Check for dollar-quote start/end
    if (char === '$') {
      let tag = '$';
      let j = i + 1;
      while (j < fullSql.length && fullSql[j] !== '$' && /[a-zA-Z_]/.test(fullSql[j])) {
        tag += fullSql[j];
        j++;
      }
      if (j < fullSql.length && fullSql[j] === '$') {
        tag += '$';
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarTag = tag;
        } else if (tag === dollarTag) {
          inDollarQuote = false;
          dollarTag = '';
        }
      }
    }

    current += char;

    if (char === ';' && !inDollarQuote) {
      const trimmed = current.trim();
      if (trimmed && trimmed !== ';') {
        statements.push(trimmed);
      }
      current = '';
    }
  }

  // Don't forget the last statement if it doesn't end with ;
  const remaining = current.trim();
  if (remaining && remaining !== ';') {
    statements.push(remaining);
  }

  return statements;
}

/**
 * Main migration runner. Executes all or a specific migration file.
 */
async function runMigrations() {
  console.log('=============================================================');
  console.log('       B-Wallet Database Migration Runner');
  console.log('=============================================================');
  console.log(`[Database]  : ${process.env.SUPABASE_URL}`);
  console.log(`[Migrations]: ${MIGRATIONS_DIR}`);
  console.log('-------------------------------------------------------------');

  // Check if a specific file was requested
  const specificFile = process.argv.find(arg => arg.startsWith('--file='));
  let migrationFiles;

  if (specificFile) {
    const fileName = specificFile.split('=')[1];
    if (!fs.existsSync(path.join(MIGRATIONS_DIR, fileName))) {
      console.error(`❌ Migration file not found: ${fileName}`);
      process.exit(1);
    }
    migrationFiles = [fileName];
  } else {
    migrationFiles = getMigrationFiles();
  }

  if (migrationFiles.length === 0) {
    console.log('⚠️  No migration files found.');
    process.exit(0);
  }

  console.log(`\nFound ${migrationFiles.length} migration(s) to execute:\n`);

  // First, ensure the exec_sql helper function exists
  await ensureExecSqlFunction();

  let successCount = 0;
  let failCount = 0;

  for (const file of migrationFiles) {
    process.stdout.write(`  ▸ ${file} ... `);

    const result = await executeMigration(file);

    if (result.success) {
      console.log('✅ OK');
      successCount++;
    } else {
      console.log(`❌ FAILED`);
      console.log(`    Error: ${result.error}`);
      failCount++;
    }
  }

  console.log('\n-------------------------------------------------------------');
  console.log(`Results: ${successCount} succeeded, ${failCount} failed, ${migrationFiles.length} total`);
  console.log('=============================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

/**
 * Creates a helper exec_sql() PostgreSQL function that allows
 * executing arbitrary SQL via Supabase RPC.
 * This function uses SECURITY DEFINER to run with elevated privileges.
 */
async function ensureExecSqlFunction() {
  const createFnSql = `
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
  `;

  try {
    // Try to create the function via a direct REST call
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ sql_query: createFnSql })
      }
    );

    if (response.ok || response.status === 204) {
      return; // Function already exists or was created
    }

    // If exec_sql doesn't exist yet, we need to create it via the SQL endpoint
    // Use the Supabase Management API or the pg_net extension
    // As a bootstrap, try calling the function creation directly
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: 'SELECT 1' });

    if (error) {
      // Function doesn't exist, need to bootstrap it
      console.log('\n  ℹ️  Bootstrapping exec_sql helper function...');
      console.log('  ⚠️  If this fails, please run the following SQL in your Supabase SQL Editor:');
      console.log('  ────────────────────────────────────────────────');
      console.log(createFnSql);
      console.log('  ────────────────────────────────────────────────\n');
    }
  } catch (err) {
    console.log('\n  ℹ️  exec_sql helper function check skipped (will attempt migration directly).');
  }
}

// Execute
runMigrations().catch(err => {
  console.error('Fatal migration error:', err.message);
  process.exit(1);
});
