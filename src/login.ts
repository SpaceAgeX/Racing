import { accountFetch, authClient, currentUser, nextDestination } from './auth/session.ts';

const next = nextDestination(new URLSearchParams(location.search).get('next'));
const status = document.querySelector<HTMLElement>('#login-status')!;
const google = document.querySelector<HTMLButtonElement>('#google-sign-in')!;
const googleNote = document.querySelector<HTMLElement>('#google-note')!;
const form = document.querySelector<HTMLFormElement>('#login-form')!;
const email = document.querySelector<HTMLInputElement>('#login-email')!;
const password = document.querySelector<HTMLInputElement>('#login-password')!;
document.querySelector<HTMLAnchorElement>('#create-link')!.href = `/signup/?next=${encodeURIComponent(next)}`;

try {
  const { client, config } = await authClient();
  google.disabled = !config.googleEnabled;
  googleNote.hidden = config.googleEnabled;
  async function finishSignIn(): Promise<void> {
    const response = await accountFetch('/api/account', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load your account.');
    const profile = await response.json() as { username: string | null };
    location.replace(profile.username ? next : `/signup/?complete=1&next=${encodeURIComponent(next)}`);
  }
  if (await currentUser(client)) await finishSignIn();

  google.addEventListener('click', async () => {
    status.textContent = 'Opening Google sign-in...';
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: {
      redirectTo: `${location.origin}/login/?next=${encodeURIComponent(next)}`,
    } });
    if (error) status.textContent = error.message;
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void (async () => {
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      submit.disabled = true;
      status.textContent = 'Signing in...';
      const { error } = await client.auth.signInWithPassword({ email: email.value, password: password.value });
      if (error) { status.textContent = error.message; submit.disabled = false; return; }
      try { await finishSignIn(); }
      catch (failure) { status.textContent = failure instanceof Error ? failure.message : 'Could not sign in.'; submit.disabled = false; }
    })();
  });
} catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not connect to accounts.'; }
