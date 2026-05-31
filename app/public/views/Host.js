// Host dashboard — one panel, contextual "Next" button, share panel, live feed, leaderboard.

import { html } from '../lib.js';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { Avatar, Button, Pill, Countdown, StatusPill, Modal, Mascot } from '../components/ui.js';
import { NodeMap } from '../components/NodeMap.js';
import { Submission } from '../components/Submission.js';
import { ShareCard, ShareModal } from '../components/ShareCard.js';
import { eventState, identity } from '../store.js';
import { actions } from '../ws.js';

const NEXT_LABEL = {
  locked: { label: '📢 公布题目', kind: 'primary' },
  reveal: { label: '▶ 开放提交',   kind: 'primary' },
  open:   { label: '⏹ 关闭并投票', kind: 'secondary' },
  voting: { label: '🏆 展示榜单',  kind: 'accent' },
  result: { label: '➡ 下一关',     kind: 'primary' },
  done:   { label: '➡ 下一关',     kind: 'primary' },
};

const TIPS = {
  lobby:  '开课前问候 60 秒，介绍 LightningClass 的玩法（提交→投票→揭榜），然后点「开始培训」。',
  locked: (n) => `Node ${n.seq}：「${n.title}」。简单介绍 ${n.tools.join('、')}，然后公布题目。`,
  reveal: (n) => `解读题目要点，提醒「${n.warning ?? '认真思考再下笔'}」，然后开放提交。`,
  open:   '观察实时提交流。30s 还无人提交？口播鼓励：「用一键复制按钮就行～」',
  voting: '提醒：「3 张选票要花在最值得的答案上」。',
  result: '揭榜！点评前 3 名，分析为何这个答案能打动大家。',
  done:   '本关结束。',
};

export const Host = () => {
  const ev = eventState.value;
  if (!ev) return null;
  const node = ev.activeNodeIdx >= 0 ? ev.nodes[ev.activeNodeIdx] : null;
  const [shareOpen, setShareOpen] = useState(false);

  // Keyboard shortcut: space = advance, "p" = pause
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches?.('input,textarea')) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (ev.status === 'lobby') actions.hostTransition('start');
        else actions.hostTransition('next');
      }
      if (e.key === 'p' && ev.status === 'running') {
        if (ev.countdownEnd) actions.hostTransition('pause');
        else if (ev.pausedRemaining != null) actions.hostTransition('resume');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ev.status, ev.countdownEnd, ev.pausedRemaining]);

  const subs = useMemo(() => {
    if (!node) return [];
    return ev.submissions
      .filter(s => s.nodeIdx === ev.activeNodeIdx)
      .sort((a,b) => b.createdAt - a.createdAt);
  }, [ev.submissions, ev.activeNodeIdx]);

  return html`
    <div>
      <header class="topbar">
        <div class="brand">
          <div class="logo">🎤</div>
          <span>主持人台</span>
          <span class="event-tag">${ev.code}</span>
        </div>
        <div class="right">
          ${EventStatusBadge(ev)}
          <${Button} kind="ghost" size="sm" onClick=${() => setShareOpen(true)}>
            📲 邀请学员
          <//>
          <${Button} kind="ghost" size="sm" hold
                     title="按住 0.6 秒确认"
                     onClick=${() => actions.hostTransition('reset')}>
            ⟲ 重置
          <//>
        </div>
      </header>

      <div class="host-grid">
        <div class="host-main">
          ${ev.status === 'lobby' && LobbyPanel(ev)}
          ${ev.status === 'running' && node && NodePanel(ev, node)}
          ${ev.status === 'finale' && FinalePanel(ev)}
          ${ev.status === 'finished' && FinishedPanel()}

          ${ev.status === 'running' && node && html`
            <div>
              <div class="waterfall-head" style=${{ padding: '0 var(--s-2)' }}>
                <h3>📡 实时提交流</h3>
                <span class="count">${subs.length} 份 · 时间倒排</span>
              </div>
              <div class="waterfall" style=${{ marginTop: 'var(--s-2)' }}>
                ${subs.length === 0
                  ? html`<div class="surface surface-padded text-center text-sm text-mute">还没有提交…</div>`
                  : subs.map((s) => html`<${Submission}
                      key=${s.id}
                      sub=${s}
                      author=${ev.participants.find(p => p.clientId === s.clientId)}
                      mineClientId=${null} />`)}
              </div>
            </div>`}
        </div>

        <aside class="host-side">
          <${ShareCard} code=${ev.code} />
          ${Leaderboard(ev)}
          <div class="host-card">
            <div class="label">📍 节点地图</div>
            <${NodeMap} nodes=${ev.nodes} activeIdx=${ev.activeNodeIdx} />
          </div>
          <div class="tile">
            <div class="label">💡 主持小贴士</div>
            <p class="text-sm" style=${{ lineHeight: 1.6 }}>${currentTip(ev, node)}</p>
            <p class="text-xs text-mute" style=${{ marginTop: 'var(--s-2)' }}>
              快捷键：空格 = 下一步 · P = 暂停/继续
            </p>
          </div>
        </aside>
      </div>

      <${ShareModal} open=${shareOpen} onClose=${() => setShareOpen(false)} code=${ev.code} />
    </div>`;
};

function currentTip(ev, node) {
  if (ev.status === 'lobby') return TIPS.lobby;
  if (!node) return '—';
  const t = TIPS[node.fsmState];
  return typeof t === 'function' ? t(node) : t;
}

function EventStatusBadge(ev) {
  if (ev.status === 'lobby') return html`<span class="status-pill status-locked">🛋 候场</span>`;
  if (ev.status === 'finale') return html`<span class="status-pill status-voting">🎉 颁奖</span>`;
  if (ev.status === 'finished') return html`<span class="status-pill status-done">✓ 已结束</span>`;
  return html`<span class="status-pill status-open">▶ Node ${ev.activeNodeIdx + 1}/20</span>`;
}

function LobbyPanel(ev) {
  const online = ev.participants.filter(p => p.online).length;
  const total = ev.participants.length;
  return html`
    <div class="host-card text-center">
      <${Mascot} size=${48} />
      <h2 style=${{ margin: 'var(--s-3) 0 4px' }}>候场中</h2>
      <p class="text-sm text-mute">${online} 人在线（已加入 ${total} 人）</p>

      <div style=${{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center', margin: 'var(--s-4) 0' }}>
        ${ev.participants.map(p => html`<${Avatar} key=${p.clientId} emoji=${p.avatar} name=${p.name} offline=${!p.online} />`)}
      </div>

      <${Button} kind="primary" size="lg" disabled=${total === 0} onClick=${() => actions.hostTransition('start')}>
        🚀 开始培训
      <//>
      ${total === 0 && html`<p class="text-xs text-mute" style=${{ marginTop: 'var(--s-2)' }}>把入场码或链接发给学员，他们加入后即可开始</p>`}
    </div>`;
}

function NodePanel(ev, node) {
  const filled = (template) => template?.replace(/\{name\}/g, '[学员暱称]');
  const next = NEXT_LABEL[node.fsmState];
  const subs = ev.submissions.filter(s => s.nodeIdx === ev.activeNodeIdx);
  const totalVotes = subs.reduce((sum, s) => sum + s.voteCount, 0);
  const isPaused = ev.countdownEnd == null && ev.pausedRemaining != null;

  return html`
    <div class="host-card">
      <div class="row" style=${{ marginBottom: 'var(--s-3)' }}>
        <div class="node-icon">${node.icon}</div>
        <div class="grow">
          <div class="node-phase">${node.phaseName} · Node ${node.seq}/20</div>
          <div class="node-title">${node.title}</div>
        </div>
        <${StatusPill} state=${node.fsmState} />
      </div>

      <div class="node-question" style=${{ marginBottom: 'var(--s-3)' }}>${node.question}</div>

      <div class="host-stats">
        <div class="host-stat"><div class="num">${ev.participants.filter(p => p.online).length}</div><div class="label">在线</div></div>
        <div class="host-stat"><div class="num">${subs.length}<span class="text-sm text-mute">/${ev.participants.length}</span></div><div class="label">已提交</div></div>
        <div class="host-stat"><div class="num">${totalVotes}</div><div class="label">投票数</div></div>
        <div class="host-stat"><${Countdown} endsAt=${ev.countdownEnd} paused=${isPaused} pausedRemaining=${ev.pausedRemaining} /><div class="label">剩余</div></div>
      </div>

      <div class="host-actions">
        <${Button} kind=${next.kind} onClick=${() => actions.hostTransition('next')}>
          ${next.label}
        <//>
        ${(node.fsmState === 'open' || node.fsmState === 'voting') && html`
          <${Button} kind="ghost" size="sm" onClick=${() => actions.hostExtend(60)}>+60s<//>
          ${isPaused
            ? html`<${Button} kind="ghost" size="sm" onClick=${() => actions.hostTransition('resume')}>▶ 继续<//>`
            : html`<${Button} kind="ghost" size="sm" onClick=${() => actions.hostTransition('pause')}>⏸ 暂停<//>`}
        `}
        <${Button} kind="ghost" size="sm" hold title="按住确认"
                   onClick=${() => actions.hostTransition('back')}>↶ 上一步<//>
        <div style=${{ marginLeft: 'auto' }}>
          <span class="text-xs text-mute">空格快进</span>
        </div>
      </div>
    </div>`;
}

function Leaderboard(ev) {
  const lb = ev.leaderboard.slice(0, 12);
  if (lb.length === 0) return html`
    <div class="leaderboard">
      <h3>🏆 实时排行榜</h3>
      <div class="text-center text-sm text-mute" style=${{ padding: 'var(--s-4)' }}>等学员加入…</div>
    </div>`;

  return html`
    <div class="leaderboard">
      <h3>🏆 实时排行榜</h3>
      ${lb.map(p => html`
        <div key=${p.clientId} class=${`lb-row ${p.rank === 1 ? 'r1' : ''}`}>
          <span class="rank">#${p.rank}</span>
          <${Avatar} emoji=${p.avatar} name=${p.name} />
          <span class="name">${p.name}</span>
          <span class="badges">${p.badges.slice(0,3).map(b => b.emoji).join('')}</span>
          <span class="xp">${p.xp}</span>
        </div>`)}
    </div>`;
}

function FinalePanel(ev) {
  return html`
    <div class="host-card text-center">
      <div style=${{ fontSize: 48 }}>🎉</div>
      <h2 style=${{ margin: 'var(--s-3) 0 4px' }}>颁奖典礼进行中</h2>
      <p class="text-sm text-mute">学员端正在播放奖台与烟花</p>
      <${Button} kind="ghost" hold onClick=${() => actions.hostTransition('finish')}>
        结束培训
      <//>
    </div>`;
}

function FinishedPanel() {
  return html`
    <div class="host-card text-center">
      <div style=${{ fontSize: 48 }}>✓</div>
      <h2 style=${{ margin: 'var(--s-3) 0 4px' }}>培训已结束</h2>
      <p class="text-sm text-mute">学员可继续查看自己的战绩页</p>
    </div>`;
}
