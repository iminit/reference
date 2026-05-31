// Play: learner's main game view, FSM-driven.

import { html } from '../lib.js';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { Avatar, Pill, Button, Countdown, CopyButton, Mascot } from '../components/ui.js';
import { NodeMap } from '../components/NodeMap.js';
import { Submission } from '../components/Submission.js';
import { eventState, identity, myParticipant, activeNode } from '../store.js';
import { actions } from '../ws.js';

export const Play = () => {
  const ev = eventState.value;
  const me = myParticipant.value;
  const node = activeNode.value;
  if (!ev || !node) return null;

  // ---- Sub-view by FSM ----
  return html`
    <div>
      ${Topbar(ev, me)}
      <div class="container stack">
        <${NodeMap} nodes=${ev.nodes} activeIdx=${ev.activeNodeIdx} />
        ${NodeCard(node)}
        ${node.fsmState === 'reveal' && RevealState(node)}
        ${node.fsmState === 'open' && OpenState({ ev, node, me })}
        ${node.fsmState === 'voting' && VotingState({ ev, node, me })}
        ${node.fsmState === 'result' && ResultState({ ev, node, me })}
      </div>
    </div>`;
};

function Topbar(ev, me) {
  const learners = ev.participants;
  return html`
    <header class="topbar">
      <div class="brand">
        <div class="logo">⚡</div>
        <span>Node ${ev.activeNodeIdx + 1}/20</span>
      </div>

      <div class="roster">
        ${learners.slice(0, 24).map((p) => html`
          <${Avatar} key=${p.clientId}
                     emoji=${p.avatar}
                     name=${p.name}
                     me=${p.clientId === identity.value.clientId}
                     offline=${!p.online} />`)}
        ${learners.length > 24 && html`<span class="text-xs text-mute" style=${{ marginLeft: '6px' }}>+${learners.length - 24}</span>`}
      </div>

      <div class="right">
        <${Pill} kind="streak" icon="🔥">${me?.streak ?? 0}<//>
        <${Pill} kind="xp" icon="⚡">${me?.xp ?? 0}<//>
      </div>
    </header>`;
}

function NodeCard(node) {
  const filled = (template) => template?.replace(/\{name\}/g, identity.value.name ?? '');

  return html`
    <div class="node-card" data-accent=${node.accent}>
      <div class="node-card-head">
        <div class="node-icon">${node.icon}</div>
        <div class="node-meta">
          <div class="node-phase">${node.phaseName} · Node ${node.seq}/20</div>
          <div class="node-title">${node.title}</div>
          <div class="node-diff">${'★'.repeat(node.difficulty)} · ${node.durationSec}s</div>
        </div>
      </div>

      <div class="node-body stack">
        <div class="tools-row">
          ${node.tools.map((t) => html`<span class="tool-tag">${t}</span>`)}
        </div>

        <div class="node-question">${node.question}</div>

        ${node.warning && html`<div class="tip">⚠️ ${node.warning}</div>`}

        ${node.promptTemplate && html`
          <div class="prompt-block">
            <${CopyButton} text=${filled(node.promptTemplate)} />
            ${filled(node.promptTemplate)}
          </div>`}

        ${node.externalLink && html`
          <a class="btn btn-secondary btn-sm" href=${node.externalLink} target="_blank" rel="noopener">
            🔗 打开 AI 工具
          </a>`}
      </div>
    </div>`;
}

function RevealState(node) {
  return html`
    <div class="surface surface-padded text-center">
      <${Mascot} size=${48} />
      <h3 style=${{ margin: 'var(--s-3) 0 4px' }}>题目已公布</h3>
      <p class="text-sm text-mute">等主持人开放提交·先准备好你的 AI 工具</p>
    </div>`;
}

function OpenState({ ev, node, me }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill from existing submission if any
  const mySub = useMemo(() => ev.submissions.find(s => s.nodeIdx === ev.activeNodeIdx && s.clientId === identity.value.clientId), [ev.submissions, ev.activeNodeIdx]);
  useEffect(() => {
    if (mySub && text === '') setText(mySub.content);
  }, [mySub?.id]);

  const onSubmit = () => {
    if (!text.trim()) return;
    setSubmitting(true);
    actions.submit(text.trim());
    setTimeout(() => setSubmitting(false), 400);
  };

  const subs = useMemo(
    () => ev.submissions.filter(s => s.nodeIdx === ev.activeNodeIdx).sort((a,b) => b.createdAt - a.createdAt),
    [ev.submissions, ev.activeNodeIdx]
  );

  return html`
    <div class="stack">
      <div class="surface surface-padded">
        <div class="row-between" style=${{ marginBottom: 'var(--s-2)' }}>
          <div class="label" style=${{ margin: 0 }}>你的提交</div>
          <${Countdown} endsAt=${ev.countdownEnd} paused=${ev.countdownEnd == null && ev.pausedRemaining != null} pausedRemaining=${ev.pausedRemaining} />
        </div>
        <textarea class="textarea"
                  placeholder=${node.placeholder || '把 AI 的回答粘贴到这里…'}
                  value=${text}
                  maxLength=${5000}
                  onInput=${(e) => setText(e.target.value)} />
        <div class="submit-bar">
          <span class="submit-counter">${text.length} / 5000</span>
          <div class="row">
            ${mySub && html`<span class="text-xs" style=${{ color: 'var(--emerald)' }}>✓ 已提交（可修改后再交）</span>`}
            <${Button} kind="primary" disabled=${!text.trim() || submitting} onClick=${onSubmit}>
              ${mySub ? '🔄 更新提交' : '⚡ 提交'}
            <//>
          </div>
        </div>
      </div>

      <div>
        <div class="waterfall-head">
          <h3>🌊 实时瀑布流</h3>
          <span class="count">${subs.length} 份 · 时间倒排</span>
        </div>
        <div class="waterfall" style=${{ marginTop: 'var(--s-2)' }}>
          ${subs.length === 0
            ? html`<div class="text-center text-sm text-mute" style=${{ padding: 'var(--s-6)' }}>等待大家开始提交…</div>`
            : subs.map((s) => html`<${Submission}
                key=${s.id}
                sub=${s}
                author=${ev.participants.find(p => p.clientId === s.clientId)}
                mineClientId=${identity.value.clientId} />`)}
        </div>
      </div>
    </div>`;
}

function VotingState({ ev, node, me }) {
  const subs = useMemo(
    () => ev.submissions.filter(s => s.nodeIdx === ev.activeNodeIdx).sort((a,b) => b.createdAt - a.createdAt),
    [ev.submissions, ev.activeNodeIdx]
  );
  const myVotes = ev.yourVotes ?? [];
  const left = 3 - myVotes.length;

  return html`
    <div class="stack">
      <div class="tile text-center">
        <div style=${{ fontWeight: 700, fontSize: 15 }}>🗳 投票时间·你有 ${left} 票</div>
        <div class="text-sm text-mute" style=${{ marginTop: 4 }}>不能投自己·点已投按钮可撤回</div>
        <div style=${{ marginTop: 'var(--s-3)' }}>
          <${Countdown} endsAt=${ev.countdownEnd} paused=${ev.countdownEnd == null && ev.pausedRemaining != null} pausedRemaining=${ev.pausedRemaining} />
        </div>
      </div>

      <div>
        <div class="waterfall-head">
          <h3>📊 同侪作品</h3>
          <span class="count">${subs.length} 份</span>
        </div>
        <div class="waterfall" style=${{ marginTop: 'var(--s-2)' }}>
          ${subs.map((s) => html`<${Submission}
              key=${s.id}
              sub=${s}
              author=${ev.participants.find(p => p.clientId === s.clientId)}
              mineClientId=${identity.value.clientId}
              showVote
              voted=${myVotes.includes(s.id)}
              votesLeft=${left}
              onVote=${actions.vote}
              onUnvote=${actions.unvote} />`)}
        </div>
      </div>

      <div class="vote-bar">
        <span style=${{ fontSize: 13, fontWeight: 700 }}>你的选票</span>
        <div class="vote-tokens">
          ${[0,1,2].map(i => html`
            <span class=${`vote-token ${i < myVotes.length ? 'used' : ''}`}>❤</span>
          `)}
        </div>
      </div>
    </div>`;
}

function ResultState({ ev, node, me }) {
  const subs = useMemo(
    () => ev.submissions.filter(s => s.nodeIdx === ev.activeNodeIdx).sort((a,b) => b.voteCount - a.voteCount || a.createdAt - b.createdAt),
    [ev.submissions, ev.activeNodeIdx]
  );

  return html`
    <div class="stack">
      <div class="tile text-center" style=${{ background: 'linear-gradient(135deg, var(--sun-50), var(--peach-50))' }}>
        <div style=${{ fontSize: 28 }}>🏆</div>
        <div style=${{ fontWeight: 800, fontSize: 17, marginTop: 4 }}>本关揭榜</div>
        <div class="text-sm text-mute" style=${{ marginTop: 4 }}>主持人正在点评·按得票排序</div>
      </div>

      <div class="waterfall">
        ${subs.map((s, idx) => html`<${Submission}
            key=${s.id}
            sub=${s}
            author=${ev.participants.find(p => p.clientId === s.clientId)}
            mineClientId=${identity.value.clientId}
            rank=${idx + 1} />`)}
      </div>
    </div>`;
}
