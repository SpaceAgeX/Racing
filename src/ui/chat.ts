import type { ChatMessage } from '../multiplayer/protocol.ts';

export function createChat(send: (text: string) => void, onOpenChange: (open: boolean) => void) {
  let roomId: string | null = null;
  let open = false;
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
  function setOpen(value: boolean) {
    open = value && !!roomId;
    panel.hidden = !open;
    if (open) { unread = 0; toggle.textContent = 'Chat (T)'; }
    onOpenChange(open);
    if (open) { input.focus(); messages.scrollTop = messages.scrollHeight; }
    else if (root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }
  toggle.onclick = () => setOpen(!open);
  root.querySelector<HTMLButtonElement>('.chat-close')!.onclick = () => setOpen(false);
  root.querySelector('form')!.onsubmit = event => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) { send(text); input.value = ''; }
    input.focus();
  };
  function onKey(event: KeyboardEvent) {
    if (!roomId || event.isComposing) return;
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
      messages.append(row);
      while (messages.children.length > 100) messages.firstElementChild!.remove();
      messages.scrollTop = messages.scrollHeight;
      if (!open) toggle.textContent = `Chat (T) · ${++unread} new`;
    },
    dispose() { window.removeEventListener('keydown', onKey, true); root.remove(); },
  };
}
