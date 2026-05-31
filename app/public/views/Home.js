// Home view: create event OR join event by code.

import { html } from '../lib.js';
import { useState } from 'preact/hooks';
import { Button, Mascot } from '../components/ui.js';
import { actions } from '../ws.js';
import { hostingEvents, navigate } from '../store.js';

export const Home = () => {
  const [mode, setMode] = useState(null); // 'create' | 'join'
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const onCreate = () => actions.createEvent(name.trim() || 'LightningClass');
  const onJoin = () => {
    const c = code.trim().toUpperCase();
    if (c.length === 6) navigate(`/e/${c}`);
  };

  if (mode === 'create') return html`
    <div class="center-stage">
      <div class="hero">
        <${Mascot} size=${64} />
        <h1>开启一场培训</h1>
        <p class="sub">你将成为本场培训的主持人</p>

        <div class="surface surface-padded" style=${{ textAlign: 'left' }}>
          <label class="label" for="ev-name">培训名（可选）</label>
          <input id="ev-name" class="input input-lg" value=${name}
                 placeholder=${"例如：五月公开课 #042"}
                 maxLength=${60}
                 onInput=${(e) => setName(e.target.value)}
                 onKeyDown=${(e) => e.key === 'Enter' && onCreate()}
                 autoFocus />
          <${Button} kind="primary" size="lg" block onClick=${onCreate}>
            创建并进入主持人台 →
          <//>
        </div>

        <div style=${{ marginTop: 'var(--s-4)' }}>
          <${Button} kind="ghost" size="sm" onClick=${() => setMode(null)}>← 返回<//>
        </div>
      </div>
    </div>`;

  if (mode === 'join') return html`
    <div class="center-stage">
      <div class="hero">
        <${Mascot} size=${64} />
        <h1>加入培训</h1>
        <p class="sub">输入主持人提供的 6 位入场码</p>

        <div class="surface surface-padded" style=${{ textAlign: 'left' }}>
          <label class="label" for="ev-code">入场码</label>
          <input id="ev-code" class="input input-lg input-code"
                 value=${code}
                 maxLength=${6}
                 placeholder="ABCDEF"
                 onInput=${(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                 onKeyDown=${(e) => e.key === 'Enter' && onJoin()}
                 autoFocus />
          <${Button} kind="primary" size="lg" block disabled=${code.length !== 6} onClick=${onJoin}>
            进入 →
          <//>
        </div>

        <div style=${{ marginTop: 'var(--s-4)' }}>
          <${Button} kind="ghost" size="sm" onClick=${() => setMode(null)}>← 返回<//>
        </div>
      </div>
    </div>`;

  // Landing
  return html`
    <div class="center-stage">
      <div class="hero">
        <${Mascot} size=${72} />
        <h1>LightningClass</h1>
        <p class="sub">2 小时·20 关·和大家一起把 AI 玩透</p>

        <div class="choice-grid">
          <div class="choice-card" onClick=${() => setMode('create')}>
            <div class="icon-big">🎤</div>
            <h3>开启一场培训</h3>
            <p>我是主持人，要开课</p>
          </div>
          <div class="choice-card" onClick=${() => setMode('join')}>
            <div class="icon-big">⚡</div>
            <h3>加入培训</h3>
            <p>我有入场码</p>
          </div>
        </div>

        ${hostingEvents.value.length > 0 && html`
          <div style=${{ marginTop: 'var(--s-8)' }}>
            <div class="label" style=${{ textAlign: 'left' }}>你之前主持过</div>
            <div style=${{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)', marginTop: 'var(--s-2)' }}>
              ${hostingEvents.value.map((c) => html`
                <${Button} key=${c} kind="ghost" size="sm" onClick=${() => navigate(`/e/${c}`)}>
                  ${c} →
                <//>`)}
            </div>
          </div>`}

        <p class="text-xs text-mute" style=${{ marginTop: 'var(--s-8)' }}>
          匿名进入 · 无需注册 · 数据存在你的浏览器和服务器内存中
        </p>
      </div>
    </div>`;
};
