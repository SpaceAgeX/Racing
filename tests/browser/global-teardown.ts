import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

export default async function teardown() {
  process.loadEnvFile('.env.local');
  const { id } = JSON.parse(await readFile('test-results/auth-user.json', 'utf8')) as { id: string };
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { await db.query('delete from public.tracks where owner_id=$1', [id]); }
  finally { await db.end(); }
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } });
  const deleted = await admin.auth.admin.deleteUser(id);
  if (deleted.error) throw deleted.error;
}
