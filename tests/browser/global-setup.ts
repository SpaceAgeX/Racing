import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

export default async function setup() {
  process.loadEnvFile('.env.local');
  const url = process.env.SUPABASE_URL!;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const secretKey = process.env.SUPABASE_SECRET_KEY!;
  if (!url || !publishableKey || !secretKey || !process.env.DATABASE_URL) {
    throw new Error('Browser tests need a dedicated test Supabase project and SUPABASE_SECRET_KEY in .env.local; they create and delete accounts.');
  }
  const email = `racing-test-${randomUUID()}@example.test`;
  const password = randomUUID() + 'Aa1!';
  const username = `Test${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const admin = createClient(url, secretKey, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { username } });
  if (created.error || !created.data.user) throw created.error ?? new Error('Could not create test account.');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('update public.profiles set can_publish_ranked_tracks=true where user_id=$1', [created.data.user.id]);
  } finally { await db.end(); }
  const browserAuth = createClient(url, publishableKey, { auth: { persistSession: false } });
  const signedIn = await browserAuth.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('Could not sign in test account.');
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/auth-state.json', JSON.stringify({ cookies: [], origins: [
    { origin: 'http://127.0.0.1:3100', localStorage: [{ name: storageKey, value: JSON.stringify(signedIn.data.session) }] },
  ] }));
  await writeFile('test-results/auth-user.json', JSON.stringify({ id: created.data.user.id }));
}
