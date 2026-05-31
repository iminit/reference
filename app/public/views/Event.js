// Event route: based on whether you're host, what status the event is in, what FSM state.

import { html } from '../lib.js';
import { useEffect } from 'preact/hooks';
import { eventState, identity, isHost, route, connected } from '../store.js';
import { actions } from '../ws.js';
import { Entry } from './Entry.js';
import { Lobby } from './Lobby.js';
import { Play } from './Play.js';
import { Host } from './Host.js';
import { Finale } from './Finale.js';
import { Mascot } from '../components/ui.js';

export const Event = ({ code }) => {
  const ev = eventState.value;

  // Join event when route lands (but only after connected)
  useEffect(() => {
    if (!connected.value) return;
    if (!ev || ev.code !== code) {
      // Without identity (no name yet), still join silently as "spectator candidate"
      actions.joinEvent(code, identity.value.name, identity.value.avatar);
    }
  }, [code, connected.value]);

  // Loading state
  if (!ev || ev.code !== code) {
    return html`
      <div class="center-stage">
        <div class="hero">
          <${Mascot} size=${64} />
          <p class="text-sm text-mute" style=${{ marginTop: 'var(--s-4)' }}>正在连接 ${code}…</p>
        </div>
      </div>`;
  }

  // Host view (creator's perspective)
  if (isHost.value) return html`<${Host} />`;

  // Learner needs nickname first
  const me = ev.participants.find(p => p.clientId === identity.value.clientId);
  if (!me) return html`<${Entry} eventCode=${code} eventName=${ev.name} />`;

  // FSM-based routing
  if (ev.status === 'lobby')   return html`<${Lobby} />`;
  if (ev.status === 'running') return html`<${Play} />`;
  if (ev.status === 'finale' || ev.status === 'finished') return html`<${Finale} />`;

  return null;
};
