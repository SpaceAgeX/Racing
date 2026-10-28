import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const migration = await readFile(new URL('../supabase/migrations/20261028200000_default_profile_country_us.sql', import.meta.url), 'utf8');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query('begin');
  await db.query(migration);
  await db.query('commit');
  console.log('Profile country default migration applied.');
} catch (error) {
  await db.query('rollback');
  throw error;
} finally {
  await db.end();
}
