import { Pool } from 'pg';
import { Container } from 'typedi';
import { config } from '../config';
import logger from '../utils/logger';

export const loadPostgres = async (): Promise<Pool> => {
  // 1. Smarter SSL Detection: Solves the connection rejection issue.
  // If it's a remote URL (Supabase, AWS, Render, Neon), it needs SSL.
  const isLocalhost = config.db.postgresUrl.includes('localhost') || config.db.postgresUrl.includes('127.0.0.1');
  const requiresSsl = config.isProduction || !isLocalhost || config.db.postgresUrl.includes('sslmode=require');

  const pool = new Pool({
    connectionString: config.db.postgresUrl,
    // Use undefined instead of false to prevent conflicts with the connection string
    ssl: requiresSsl ? { rejectUnauthorized: false } : undefined, 
    
    // 2. Scale Fix: Increased from 10 to 75 to handle high concurrent auth traffic
    max: 75, 
    
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
    statement_timeout: 30000,
  });

  // 3. Resilience Fix: Catch idle client network drops so the server doesn't crash
  pool.on('error', (err) => {
    logger.error('Unexpected network error on idle PostgreSQL client', { err: err.message });
    // Do not process.exit() here! The pool will automatically discard the broken client and spawn a new one.
  });

  try {
    const client = await pool.connect();
    
    try {
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      `);
    } catch (err: any) {
      logger.warn('Failed to ensure last_active_at column exists. Continuing...', { err: err.message });
    } finally {
      // 4. Leak Fix: Ensure the client is ALWAYS released back to the pool
      client.release();
    }

    logger.info('✌️ PostgreSQL connected & patched');
  } catch (error: any) {
    logger.error('🛑 FATAL: PostgreSQL connection failed.', { 
      message: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }

  Container.set('pgPool', pool);
  return pool;
};
