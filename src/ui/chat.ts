import type { ChatMessage } from '../multiplayer/protocol.ts';

export function createChat(send: (text: string) => void, onOpenChange: (open: boolean) => void) {
  let roomId: string | null = null;
  let open = false;
  let docked = false;
  let unread = 0;
  const root = document.createElement('section');
  root.className = 'room-chat';
  root.hidden = true;
  root.innerHTML = `<button type="button" class="chat-toggle">Chat (T)</button>
    <div class="chat-panel" hidden><header>Room chat <button type="button" class="chat-close" aria-label="Close chat">Esc</button></header>
    <div class="chat-messages" role="log" aria-live="polite"></div>
    <form><input aria-label="Chat message" maxlength="300" placeholder="Message your room…" autocomplete="off"><button type="submit">Send</button></form>
    <small>Enter to send · Esc to close · Driving controls released while open</small></div>`;
  document.body.append(root);
  const toggle = root.querySelector<HTMLButtonElement>('.chat-toggle')!;
  const panel = root.querySelector<HTMLElement>('.chat-panel')!;
  const messages = root.querySelector<HTMLElement>('.chat-messages')!;
  const input = root.querySelector('input')!;
  const close = root.querySelector<HTMLButtonElement>('.chat-close')!;
  const hint = root.querySelector<HTMLElement>('small')!;
  const heading = root.querySelector<HTMLElement>('.chat-panel header')!;
  function render() {
    root.classList.toggle('is-lobby-panel', docked);
    toggle.hidden = docked;
    close.hidden = docked;
    hint.hidden = docked;
    heading.firstChild!.textContent = docked ? 'LOBBY CHAT ' : 'Room chat ';
    panel.hidden = !(docked || open);
  }
  function setOpen(value: boolean) {
    open = value && !!roomId && !docked;
    render();
    if (open) { unread = 0; toggle.textContent = 'Chat (T)'; }
    onOpenChange(open);
    if (open) { input.focus(); messages.scrollTop = messages.scrollHeight; }
    else if (root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }
  toggle.onclick = () => setOpen(!open);
  close.onclick = () => setOpen(false);
  root.querySelector('form')!.onsubmit = event => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) { send(text); input.value = ''; }
    input.focus();
  };
  function onKey(event: KeyboardEvent) {
    if (!roomId || event.isComposing) return;
    if (docked) {
      if (event.key === 'Escape' && root.contains(document.activeElement)) {
        event.preventDefault(); event.stopImmediatePropagation(); (document.activeElement as HTMLElement).blur();
      } else if (event.code === 'KeyT' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const target = event.target;
        if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select'))) return;
        event.preventDefault(); event.stopImmediatePropagation(); input.focus();
      }
      return;
    }
    if (open && event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); setOpen(false);
    } else if (!open && event.code === 'KeyT' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select'))) return;
      event.preventDefault(); event.stopImmediatePropagation(); setOpen(true);
    }
  }
  window.addEventListener('keydown', onKey, true);
  return {
    get isOpen() { return open; },
    setPresentation(host: HTMLElement | null) {
      const nextParent = host ?? document.body;
      docked = Boolean(host);
      if (root.parentElement !== nextParent) nextParent.append(root);
      if (docked && open) { open = false; onOpenChange(false); }
      render();
    },
    setRoom(id: string | null) {
      if (id !== roomId) { roomId = id; setOpen(false); messages.replaceChildren(); input.value = ''; unread = 0; toggle.textContent = 'Chat (T)'; }
      root.hidden = !id;
    },
    receive(message: ChatMessage) {
      if (message.roomId !== roomId) return;
      const row = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = message.name + ': ';
      row.append(name, document.createTextNode(message.text));
      const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
      messages.append(row);
      while (messages.children.length > 100) messages.firstElementChild!.remove();
      if (nearBottom) messages.scrollTop = messages.scrollHeight;
      if (!open && !docked) toggle.textContent = `Chat (T) · ${++unread} new`;
    },
    dispose() { window.removeEventListener('keydown', onKey, true); root.remove(); },
  };
}
