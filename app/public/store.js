// =============================================================================
//  Store · Reactive state via @preact/signals
// =============================================================================

import { signal, computed, batch } from '@preact/signals';

// ---- Identity ----
const STORAGE_KEY = 'lc.v2.identity';

function loadIdentity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const id = crypto.randomUUID();
  const fresh = { clientId: id, name: '', avatar: '' };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

const initialIdentity = loadIdentity();

export const identity = signal(initialIdentity);
export const connected = signal(false);
export const hostingEvents = signal([]);    // events this browser created

// ---- Route ----
//   route.view = 'home' | 'event'
//   route.eventCode = string|null
export const route = signal(parseRoute(location.pathname));

window.addEventListener('popstate', () => { route.value = parseRoute(location.pathname); });

export function navigate(path) {
  if (location.pathname !== path) {
    history.pushState(null, '', path);
  }
  route.value = parseRoute(path);
}

function parseRoute(pathname) {
  if (pathname.startsWith('/e/')) {
    return { view: 'event', eventCode: pathname.slice(3).toUpperCase().slice(0, 6) };
  }
  return { view: 'home', eventCode: null };
}

// ---- Event ----
// Server-pushed snapshot of the current event the user is in
export const eventState = signal(null);

// Personal state for current event
export const myParticipant = computed(() => {
  const ev = eventState.value;
  if (!ev) return null;
  return ev.participants.find((p) => p.clientId === identity.value.clientId) ?? null;
});

export const isHost = computed(() => {
  const ev = eventState.value;
  if (!ev) return false;
  return ev.hostClientId === identity.value.clientId;
});

export const activeNode = computed(() => {
  const ev = eventState.value;
  if (!ev || ev.activeNodeIdx < 0) return null;
  return ev.nodes[ev.activeNodeIdx];
});

// ---- Toasts ----
let toastSeq = 0;
export const toasts = signal([]);

export function pushToast(toast) {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, ...toast }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, toast.duration ?? 3500);
}

// ---- Identity mutations ----
export function setIdentity(updates) {
  identity.value = { ...identity.value, ...updates };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity.value));
}

// ---- XP & effects bookkeeping (for floating animations) ----
export const xpEffects = signal([]); // {id, amount, x, y}
let xpSeq = 0;
export function spawnXpFloat(amount, target) {
  const id = ++xpSeq;
  const rect = target?.getBoundingClientRect?.();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top : window.innerHeight / 2;
  xpEffects.value = [...xpEffects.value, { id, amount, x, y }];
  setTimeout(() => {
    xpEffects.value = xpEffects.value.filter((e) => e.id !== id);
  }, 1400);
}

export { batch };
