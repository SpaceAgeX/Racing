import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const migration = await readFile(new URL('../supabase/migrations/20261028210000_checkpoint_splits.sql', import.meta.url), 'utf8');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query('begin');
  await db.query(migration);
  await db.query('commit');
  console.log('Checkpoint split column is ready; earlier lap results remain unchanged.');
} catch (error) {
  await db.query('rollback');
  throw error;
} finally {
  await db.end();
}
