import { startPrototype } from './prototype.ts';
import { startAdmissionHeartbeat } from './admission.ts';
import { requireAccount } from './auth/session.ts';
const account = await requireAccount();
startAdmissionHeartbeat();

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Driving canvas is missing.');

export const prototype = startPrototype(canvas, account.profile.username!);
const accountLink = document.querySelector<HTMLButtonElement>('#home-account-link')!;
const avatar = document.querySelector<HTMLElement>('#home-account-avatar')!;
accountLink.setAttribute('aria-label', `Account menu for ${account.profile.username}`);
avatar.textContent = account.profile.username![0]!.toUpperCase();
document.querySelector<HTMLElement>('#home-profile-name')!.textContent = account.profile.username!;
const profileMenu = document.querySelector<HTMLElement>('#home-profile-menu')!;
function setProfileMenuOpen(open: boolean): void {
  profileMenu.hidden = !open;
  accountLink.setAttribute('aria-expanded', String(open));
}
accountLink.addEventListener('click', () => { setProfileMenuOpen(profileMenu.hidden === true); });
document.addEventListener('pointerdown', event => {
  if (!(event.target instanceof Node) || document.querySelector('.home-profile')?.contains(event.target)) return;
  setProfileMenuOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!profileMenu.hidden) accountLink.focus();
  setProfileMenuOpen(false);
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
