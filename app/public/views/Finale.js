// Finale: celebration view for learners.

import { html } from '../lib.js';
import { useEffect } from 'preact/hooks';
import { Button, Avatar } from '../components/ui.js';
import { eventState, identity } from '../store.js';
import { burstConfetti } from '../ws.js';

export const Finale = () => {
  const ev = eventState.value;
  if (!ev) return null;

  const lb = ev.leaderboard;
  const top3 = lb.slice(0, 3);
  const me = ev.participants.find(p => p.clientId === identity.value.clientId);

  // Confetti on mount
  useEffect(() => {
    burstConfetti(60);
    const t1 = setTimeout(() => burstConfetti(60), 1200);
    const t2 = setTimeout(() => burstConfetti(80), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const totalSubs = ev.submissions.length;
  const totalVotes = ev.submissions.reduce((s, x) => s + x.voteCount, 0);
  const totalBadges = ev.participants.reduce((s, p) => s + p.badges.length, 0);

  return html`
    <div class="finale">
      <h1>🎉 培训圆满落幕</h1>
      <p class="subtitle">恭喜你完成 20 关挑战</p>

      <div class="finale-stats">
        <div class="finale-stat"><div class="num">${ev.participants.length}</div><div class="label">勇士</div></div>
        <div class="finale-stat"><div class="num">${totalSubs}</div><div class="label">提交</div></div>
        <div class="finale-stat"><div class="num">${totalVotes}</div><div class="label">总票数</div></div>
        <div class="finale-stat"><div class="num">${totalBadges}</div><div class="label">徽章</div></div>
      </div>

      <h2 style=${{ fontSize: 24, margin: 'var(--s-6) 0 var(--s-4)', color: 'white' }}>🏆 全场前三</h2>
      <div class="podium">
        ${[1, 0, 2].map(i => {
          const p = top3[i];
          if (!p) return null;
          const rank = i + 1;
          return html`
            <div key=${p.clientId} class=${`podium-spot spot-${rank}`}>
              <div style=${{ fontSize: 56, marginBottom: 'var(--s-2)' }}>${p.avatar}</div>
              <div style=${{ fontWeight: 800, fontSize: 17 }}>${p.name}</div>
              <div style=${{ fontFamily: 'var(--font-num)', color: 'var(--sun)', fontWeight: 700, fontSize: 14, margin: '4px 0 var(--s-3)' }}>${p.xp} XP</div>
              <div class="podium-block">
                <div class="podium-medal">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</div>
                ${rank}
              </div>
            </div>`;
        })}
      </div>

      ${me && MySummary(me, lb, ev)}

      <div style=${{ marginTop: 'var(--s-8)' }}>
        <${Button} kind="primary" size="lg" onClick=${() => location.href = '/'}>返回首页<//>
      </div>
    </div>`;
};

function MySummary(me, lb, ev) {
  const myRank = lb.find(p => p.clientId === me.clientId)?.rank ?? '-';
  const mySubs = ev.submissions.filter(s => s.clientId === me.clientId);
  const myVotesReceived = mySubs.reduce((s, x) => s + x.voteCount, 0);

  return html`
    <div class="my-summary">
      <div class="row" style=${{ gap: 'var(--s-3)' }}>
        <span style=${{ fontSize: 40 }}>${me.avatar}</span>
        <div>
          <div style=${{ fontSize: 18, fontWeight: 800 }}>${me.name}</div>
          <div class="text-sm text-mute">你的战绩</div>
        </div>
      </div>

      <div class="summary-grid">
        <div class="summary-stat">
          <div style=${{ fontFamily: 'var(--font-num)', fontSize: 22, fontWeight: 800 }}>#${myRank}</div>
          <div class="text-xs text-mute">排名</div>
        </div>
        <div class="summary-stat">
          <div style=${{ fontFamily: 'var(--font-num)', fontSize: 22, fontWeight: 800, color: 'var(--peach-700)' }}>${me.xp}</div>
          <div class="text-xs text-mute">XP</div>
        </div>
        <div class="summary-stat">
          <div style=${{ fontFamily: 'var(--font-num)', fontSize: 22, fontWeight: 800, color: 'var(--sky-700)' }}>${mySubs.length}</div>
          <div class="text-xs text-mute">提交</div>
        </div>
        <div class="summary-stat">
          <div style=${{ fontFamily: 'var(--font-num)', fontSize: 22, fontWeight: 800, color: 'var(--coral-700)' }}>${myVotesReceived}</div>
          <div class="text-xs text-mute">获票</div>
        </div>
      </div>

      <div class="label">你解锁的徽章</div>
      <div class="my-badges">
        ${me.badges.length > 0
          ? me.badges.map(b => html`<span class="badge-chip">${b.emoji} ${b.name}</span>`)
          : html`<span class="text-sm text-mute">这次没拿徽章·下次努力 🌱</span>`}
      </div>
    </div>`;
}
