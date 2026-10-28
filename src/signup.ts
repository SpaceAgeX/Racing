import { accountFetch, authClient, currentUser, nextDestination } from './auth/session.ts';
import { usernameError } from './auth/username.ts';
import { countryFlagImageUrl, countryOptions } from './ui/countries.ts';

const next = nextDestination(new URLSearchParams(location.search).get('next'));
const status = document.querySelector<HTMLElement>('#signup-status')!;
const availability = document.querySelector<HTMLElement>('#username-status')!;
const username = document.querySelector<HTMLInputElement>('#signup-username')!;
const country = document.querySelector<HTMLSelectElement>('#signup-country')!;
const countryList = countryOptions();
for (const option of countryList) country.add(new Option(option.name, option.code));
const pendingCountryKey = 'racing-pending-signup-country';
const pendingCountry = sessionStorage.getItem(pendingCountryKey);
country.value = countryList.some(option => option.code === pendingCountry) ? pendingCountry! : 'US';
const countryImage = document.querySelector<HTMLImageElement>('#signup-country-flag')!;
function showCountryFlag(): void {
  countryImage.src = countryFlagImageUrl(country.value);
  countryImage.alt = `${countryList.find(option => option.code === country.value)?.name ?? 'Country'} flag`;
}
country.addEventListener('change', () => { sessionStorage.setItem(pendingCountryKey, country.value); showCountryFlag(); });
showCountryFlag();
const email = document.querySelector<HTMLInputElement>('#signup-email')!;
const password = document.querySelector<HTMLInputElement>('#signup-password')!;
const form = document.querySelector<HTMLFormElement>('#signup-form')!;
const submit = document.querySelector<HTMLButtonElement>('#signup-submit')!;
const google = document.querySelector<HTMLButtonElement>('#google-sign-up')!;
const googleNote = document.querySelector<HTMLElement>('#google-note')!;
document.querySelector<HTMLAnchorElement>('#login-link')!.href = `/login/?next=${encodeURIComponent(next)}`;

let claiming = false;
let availabilityVersion = 0;
async function checkAvailability(value: string): Promise<boolean> {
  const invalid = usernameError(value);
  if (invalid) { availability.textContent = invalid; availability.dataset.state = 'invalid'; return false; }
  const response = await fetch(`/api/username-availability?username=${encodeURIComponent(value.trim())}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not check that username.');
  const result = await response.json() as { available: boolean };
  availability.textContent = result.available ? 'Username available' : 'Username already taken';
  availability.dataset.state = result.available ? 'available' : 'invalid';
  return result.available;
}
username.addEventListener('input', () => {
  const version = ++availabilityVersion;
  const value = username.value;
  availability.textContent = value ? 'Checking username...' : '';
  window.setTimeout(() => {
    if (version !== availabilityVersion || !value) return;
    void checkAvailability(value).catch(() => { if (version === availabilityVersion) availability.textContent = 'Could not check username.'; });
  }, 250);
});

try {
  const { client, config } = await authClient();
  google.disabled = !config.googleEnabled;
  googleNote.hidden = config.googleEnabled;
  const user = await currentUser(client);
  if (user) {
    const response = await accountFetch('/api/account', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load your account.');
    const profile = await response.json() as { username: string | null };
    if (profile.username) location.replace(next);
    else {
      claiming = true;
      document.querySelector<HTMLElement>('#signup-title')!.textContent = 'Choose your username';
      document.querySelector<HTMLElement>('#signup-intro')!.textContent = 'Choose a unique username to finish setup.';
      document.querySelector<HTMLElement>('#signup-methods')!.hidden = true;
      document.querySelector<HTMLElement>('#email-fields')!.hidden = true;
      email.required = password.required = false;
      submit.textContent = 'Finish setup';
      document.querySelector<HTMLElement>('#login-link-row')!.hidden = true;
    }
  }
  google.addEventListener('click', async () => {
    sessionStorage.setItem(pendingCountryKey, country.value);
    status.textContent = 'Opening Google sign-in...';
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: {
      redirectTo: `${location.origin}/signup/?complete=1&next=${encodeURIComponent(next)}`,
    } });
    if (error) status.textContent = error.message;
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void (async () => {
      const chosen = username.value.trim();
      submit.disabled = true;
      try {
        if (!(await checkAvailability(chosen))) { submit.disabled = false; return; }
        if (claiming) {
          const response = await accountFetch('/api/account/username', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: chosen, countryCode: country.value }) });
          if (!response.ok) {
            const result = await response.json() as { error?: string };
            throw new Error(result.error ?? 'Could not save that username.');
          }
          sessionStorage.removeItem(pendingCountryKey);
          location.replace(next);
          return;
        }
        const result = await client.auth.signUp({ email: email.value, password: password.value,
          options: { data: { username: chosen, country_code: country.value },
            emailRedirectTo: `${location.origin}/login/?next=${encodeURIComponent(next)}` } });
        if (result.error) {
          if (!(await checkAvailability(chosen))) throw new Error('Username already taken.');
          throw result.error;
        }
        if (result.data.session) { sessionStorage.removeItem(pendingCountryKey); location.replace(next); }
        else status.textContent = 'Check your email to confirm your account. Local mail appears in Mailpit.';
      } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not create your account.'; }
      finally { submit.disabled = false; }
    })();
  });
} catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not connect to accounts.'; }
