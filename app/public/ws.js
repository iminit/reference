// =============================================================================
//  WS · WebSocket layer with auto-reconnect
// =============================================================================

import { identity, eventState, connected, hostingEvents, pushToast, spawnXpFloat, route, setIdentity } from './store.js';

let ws = null;
let reconnectTimer = null;
const outbox = [];

export function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.addEventListener('open', () => {
    connected.value = true;
    // First send: hello with our persistent clientId
    send({ type: 'hello', clientId: identity.value.clientId });
    // Flush any queued messages
    while (outbox.length) ws.send(JSON.stringify(outbox.shift()));
  });

  ws.addEventListener('close', () => {
    connected.value = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWS, 1500);
  });

  ws.addEventListener('error', () => { try { ws.close(); } catch {} });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handle(msg);
  });
}

export function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  else outbox.push(msg);
}

function handle(msg) {
  switch (msg.type) {
    case 'hello:ack':
      // server confirms our identity and gives us memory of prior events
      setIdentity({
        clientId: msg.clientId,
        ...(msg.lastName ? { name: msg.lastName } : {}),
        ...(msg.lastAvatar ? { avatar: msg.lastAvatar } : {}),
      });
      hostingEvents.value = msg.hostingEvents ?? [];

      // If URL pointed to an event, auto-join now
      const r = route.value;
      if (r.view === 'event' && r.eventCode) {
        // Will be joined by Event view's effect
      }
      break;

    case 'event:created':
      // Navigate to the new event
      hostingEvents.value = [...hostingEvents.value, msg.code];
      history.pushState(null, '', `/e/${msg.code}`);
      route.value = { view: 'event', eventCode: msg.code };
      break;

    case 'event:state':
      eventState.value = msg.state;
      break;

    case 'badge:awarded':
      if (msg.clientId === identity.value.clientId) {
        pushToast({
          icon: msg.badge.emoji,
          title: `解锁徽章：${msg.badge.name}`,
          desc: '继续保持～',
          duration: 3500,
        });
        burstConfetti(40);
      }
      break;

    case 'xp:gained':
      if (msg.clientId === identity.value.clientId) {
        const pill = document.querySelector('.pill-xp');
        spawnXpFloat(msg.gain, pill);
      }
      break;

    case 'error':
      pushToast({ icon: '⚠️', title: msg.message, desc: '', duration: 4000 });
      break;
  }
}

// Confetti (kept here to be triggered from message handler easily)
export function burstConfetti(count = 40) {
  const colors = ['#FF7A59', '#FACC15', '#38BDF8', '#F472B6', '#A78BFA', '#10B981'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    p.style.animationDuration = `${2 + Math.random() * 1.8}s`;
    if (Math.random() < 0.3) p.style.borderRadius = '50%';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 4500);
  }
}

// Public actions
export const actions = {
  createEvent: (name) => send({ type: 'create_event', name }),
  joinEvent: (code, name, avatar) => send({ type: 'join_event', code, name, avatar }),
  setIdentity: (name, avatar) => send({ type: 'set_identity', name, avatar }),
  submit: (content) => send({ type: 'submit', content }),
  vote: (submissionId) => send({ type: 'vote', submissionId }),
  unvote: (submissionId) => send({ type: 'unvote', submissionId }),
  hostTransition: (transition) => send({ type: 'host:transition', transition }),
  hostExtend: (seconds) => send({ type: 'host:extend', seconds }),
};
