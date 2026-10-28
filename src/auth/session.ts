import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export interface AuthConfig { url: string; publishableKey: string; googleEnabled: boolean }
export interface AccountProfile { username: string | null; displayName: string; canPublishRankedTracks: boolean; countryCode: string | null }
export interface AccountSession { user: User; profile: AccountProfile; signOut(): Promise<void> }

let client: SupabaseClient | null = null;
let config: AuthConfig | null = null;

export function nextDestination(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  const parsed = new URL(value, location.origin);
  if (parsed.origin !== location.origin || /^\/(login|signup)(\/|$)/.test(parsed.pathname)) return '/';
  return parsed.pathname + parsed.search;
}

export async function authClient(): Promise<{ client: SupabaseClient; config: AuthConfig }> {
  if (client && config) return { client, config };
  let response = await fetch('/api/auth/config', { cache: 'no-store' });
  if (response.status === 401) {
    // A restored tab may have a session cookie from a previous server process.
    const admission = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
    if (admission.status === 503) throw new Error('The game is full. Try again shortly.');
    if (!admission.ok) throw new Error('Could not enter the game. Reload and try again.');
    response = await fetch('/api/auth/config', { cache: 'no-store' });
  }
  if (!response.ok) throw new Error('The account service is unavailable. Reload and try again.');
  config = await response.json() as AuthConfig;
  if (!config.url || !config.publishableKey) throw new Error('Account configuration is missing.');
  client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return { client, config };
}

export async function currentUser(auth: SupabaseClient): Promise<User | null> {
  const { data: { session } } = await auth.auth.getSession();
  if (!session) return null;
  const { data, error } = await auth.auth.getUser();
  if (!error && data.user) return data.user;
  await auth.auth.signOut();
  return null;
}

export async function accessToken(): Promise<string> {
  if (!client) throw new Error('Sign in before accessing game data.');
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Your sign-in has expired. Reload to sign in again.');
  return data.session.access_token;
}

export async function accountFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${await accessToken()}`);
  return fetch(path, { ...options, headers, credentials: 'same-origin' });
}

export async function redirectToAccountPage(path: string): Promise<never> {
  location.replace(path);
  return new Promise<never>(() => {});
}

export async function requireAccount(): Promise<AccountSession> {
  document.body.dataset.authState = 'pending';
  const { client: auth } = await authClient();
  const user = await currentUser(auth);
  const next = encodeURIComponent(location.pathname + location.search);
  if (!user) return redirectToAccountPage(`/login/?next=${next}`);
  const response = await accountFetch('/api/account', { cache: 'no-store' });
  if (response.status === 401) return redirectToAccountPage(`/login/?next=${next}`);
  if (!response.ok) throw new Error('Could not load your account.');
  const profile = await response.json() as AccountProfile;
  if (!profile.username) return redirectToAccountPage(`/signup/?complete=1&next=${next}`);
  document.body.dataset.authState = 'ready';
  return { user, profile, async signOut() { await auth.auth.signOut(); location.assign('/login/'); } };
}
