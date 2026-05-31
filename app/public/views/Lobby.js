// Lobby: learner waiting view (event.status === 'lobby')

import { html } from '../lib.js';
import { Avatar, Mascot, Pill } from '../components/ui.js';
import { identity, eventState } from '../store.js';

export const Lobby = () => {
  const ev = eventState.value;
  if (!ev) return null;
  const learners = ev.participants;
  const onlineCount = learners.filter(p => p.online).length;

  return html`
    <div>
      <header class="topbar">
        <div class="brand">
          <div class="logo">⚡</div>
          <span>${ev.name}</span>
          <span class="event-tag">${ev.code}</span>
        </div>
      </header>

      <div class="center-stage">
        <div class="hero">
          <${Mascot} size=${64} />
          <h1>你已就位</h1>
          <p class="sub">等主持人开课·当前在线 ${onlineCount} 人</p>

          <div style=${{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)', justifyContent: 'center', marginBottom: 'var(--s-6)' }}>
            ${learners.map((p) => html`
              <${Avatar} key=${p.clientId}
                         emoji=${p.avatar}
                         name=${p.name}
                         size="lg"
                         me=${p.clientId === identity.value.clientId}
                         offline=${!p.online} />`)}
          </div>

          <div class="surface surface-padded" style=${{ textAlign: 'left' }}>
            <div class="label">⏳ 上课前可以做</div>
            <ul style=${{ listStyle: 'none', fontSize: 14, lineHeight: 2 }}>
              <li>✓ 在另一个设备/标签登录 ChatGPT 或 Claude</li>
              <li>✓ 准备好可以快速 Ctrl+C / Ctrl+V 的状态</li>
              <li>✓ 喝口水 ☕</li>
            </ul>
          </div>
        </div>
      </div>
    </div>`;
};
