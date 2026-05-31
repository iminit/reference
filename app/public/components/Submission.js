import { html } from '../lib.js';
import { Avatar } from './ui.js';

function timeSince(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s 前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m 前`;
  return `${Math.floor(sec / 3600)}h 前`;
}

export const Submission = ({ sub, author, mineClientId, rank, showVote, voted, votesLeft, onVote, onUnvote }) => {
  const isMine = sub.clientId === mineClientId;
  const cls = ['sub'];
  if (isMine) cls.push('mine');
  if (rank === 1) cls.push('rank-1');
  if (rank === 2) cls.push('rank-2');
  if (rank === 3) cls.push('rank-3');

  return html`
    <div class=${cls.join(' ')}>
      <div class="sub-head">
        ${rank && rank <= 3 && html`<span class=${`rank-badge ${rank === 2 ? 'r2' : rank === 3 ? 'r3' : ''}`}>
          ${rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
        </span>`}
        <div class="sub-author">
          <${Avatar} emoji=${author?.avatar ?? '🦊'} name=${author?.name} />
          <span>${author?.name ?? '匿名'}</span>
        </div>
        <div class="sub-badges">
          ${sub.isFirst && html`<span class="sub-tag">⚡ 首位</span>`}
          ${isMine && html`<span class="sub-tag" style=${{ background: 'var(--peach-50)', color: 'var(--peach-700)' }}>你</span>`}
        </div>
      </div>

      <div class="sub-content">${sub.content}</div>

      <div class="sub-foot">
        <span class="sub-time">${timeSince(sub.createdAt)}</span>
        <div class="vote-meta">
          ${showVote && !isMine && html`
            <button class=${`vote-btn ${voted ? 'voted' : ''}`}
                    disabled=${voted ? false : votesLeft <= 0}
                    onClick=${() => voted ? onUnvote?.(sub.id) : onVote?.(sub.id)}>
              ${voted ? '❤️ 已投' : '🤍 投一票'}
            </button>`}
          <span class="vote-count">❤ ${sub.voteCount}</span>
        </div>
      </div>
    </div>`;
};
