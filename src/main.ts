import { startPrototype } from './prototype.ts';
import { startAdmissionHeartbeat } from './admission.ts';
import { requireAccount } from './auth/session.ts';
const account = await requireAccount();
startAdmissionHeartbeat();

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Driving canvas is missing.');

export const prototype = startPrototype(canvas, account.profile.username!);
const accountLink = document.querySelector<HTMLAnchorElement>('#home-account-link')!;
const avatar = document.querySelector<HTMLElement>('#home-account-avatar')!;
accountLink.setAttribute('aria-label', `Your account: ${account.profile.username}`);
avatar.textContent = account.profile.username![0]!.toUpperCase();
document.querySelector<HTMLElement>('#home-profile-name')!.textContent = account.profile.username!;
const profileToggle = document.querySelector<HTMLButtonElement>('#home-profile-toggle')!;
const profileMenu = document.querySelector<HTMLElement>('#home-profile-menu')!;
profileToggle.addEventListener('click', () => {
  profileMenu.hidden = !profileMenu.hidden;
  profileToggle.setAttribute('aria-expanded', String(!profileMenu.hidden));
});
document.addEventListener('pointerdown', event => {
  if (!(event.target instanceof Node) || document.querySelector('.home-profile')?.contains(event.target)) return;
  profileMenu.hidden = true;
  profileToggle.setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  profileMenu.hidden = true;
  profileToggle.setAttribute('aria-expanded', 'false');
});
document.querySelector<HTMLButtonElement>('#home-sign-out')!.addEventListener('click', () => { void account.signOut(); });
const picture = account.user.user_metadata.avatar_url ?? account.user.user_metadata.picture;
if (typeof picture === 'string') {
  try {
    const url = new URL(picture);
    if (url.protocol === 'https:') {
      const image = document.createElement('img');
      image.src = url.href;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => { image.remove(); });
      avatar.append(image);
    }
  } catch { /* Keep the username initial if the provider has no usable photo. */ }
}
