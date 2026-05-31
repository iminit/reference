// =============================================================================
//  UI primitive components
// =============================================================================

import { html } from '../lib.js';
import { useEffect, useState } from 'preact/hooks';

export const AVATARS = [
  '🦊','🐻','🦁','🐯','🐰','🐼','🐨','🐸',
  '🐧','🦉','🦄','🐱','🐶','🐹','🐢','🦋',
];

export const Mascot = ({ size = 64 }) =>
  html`<span class="mascot" style=${{ fontSize: `${size}px` }}>💎</span>`;

export const Avatar = ({ emoji, name, me, host, offline, size }) => {
  const cls = ['avatar', size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : '', me ? 'me' : '', host ? 'host' : '', offline ? 'offline' : ''].filter(Boolean).join(' ');
  return html`<span class=${cls} data-tip=${name || null}>${emoji}</span>`;
};

export const Pill = ({ kind = 'default', icon, children }) =>
  html`<span class=${`pill ${kind === 'xp' ? 'pill-xp' : kind === 'streak' ? 'pill-streak' : ''}`}>
    ${icon && html`<span class="icon">${icon}</span>`}
    ${children}
  </span>`;

export const Button = ({ kind = 'primary', size, block, disabled, onClick, children, type = 'button', title, hold }) => {
  const cls = ['btn', `btn-${kind}`, size === 'lg' ? 'btn-lg' : size === 'sm' ? 'btn-sm' : '', block ? 'btn-block' : ''].filter(Boolean).join(' ');

  // Press-and-hold mode (for host destructive actions)
  if (hold) {
    return html`<${HoldButton} cls=${cls} disabled=${disabled} onClick=${onClick} title=${title}>${children}<//>`;
  }

  return html`<button type=${type} class=${cls} disabled=${disabled} onClick=${onClick} title=${title}>${children}</button>`;
};

const HoldButton = ({ cls, disabled, onClick, children, title }) => {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    if (!holding) return;
    const start = Date.now();
    const duration = 600;
    const t = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / duration);
      setProgress(p);
      if (p >= 1) {
        clearInterval(t);
        setHolding(false);
        setProgress(0);
        onClick?.();
      }
    }, 30);
    return () => clearInterval(t);
  }, [holding]);

  return html`
    <button type="button" class=${cls + ' btn-hold'} title=${title} disabled=${disabled}
            onMouseDown=${() => setHolding(true)}
            onMouseUp=${() => { setHolding(false); setProgress(0); }}
            onMouseLeave=${() => { setHolding(false); setProgress(0); }}
            onTouchStart=${(e) => { e.preventDefault(); setHolding(true); }}
            onTouchEnd=${() => { setHolding(false); setProgress(0); }}
            style=${{ position: 'relative', overflow: 'hidden' }}>
      <span style=${{ position: 'relative', zIndex: 2 }}>${holding ? '按住…' : children}</span>
      <span style=${{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.18)', width: `${progress * 100}%`, transition: 'width .03s linear', zIndex: 1 }}></span>
    </button>`;
};

export const StatusPill = ({ state }) => {
  const label = {
    locked: '🔒 未开放',
    reveal: '👀 已公布',
    open:   '✍️ 提交中',
    voting: '🗳 投票中',
    result: '🏆 揭榜',
    done:   '✓ 完成',
  }[state] ?? state;
  return html`<span class=${`status-pill status-${state}`}>${label}</span>`;
};

// Countdown auto-ticking component
export const Countdown = ({ endsAt, paused, pausedRemaining }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  let remaining;
  if (endsAt) remaining = Math.max(0, endsAt - now);
  else if (pausedRemaining != null) remaining = pausedRemaining;
  else return null;

  const s = Math.ceil(remaining / 1000);
  const m = Math.floor(s / 60);
  const text = `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  const cls = ['countdown'];
  if (paused) cls.push('paused');
  else if (remaining < 15000 && remaining > 0) cls.push('urgent');

  return html`<span class=${cls.join(' ')}>${paused ? '⏸' : '⏱'} ${text}</span>`;
};

// Modal wrapper
export const Modal = ({ open, onClose, children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return html`
    <div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
      <div class="modal">${children}</div>
    </div>`;
};

// Copyable text + copy state
export const CopyButton = ({ text, label = '复制', copiedLabel = '✓ 已复制' }) => {
  const [copied, setCopied] = useState(false);
  return html`
    <button class=${`prompt-copy ${copied ? 'copied' : ''}`}
            onClick=${async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              } catch {}
            }}>
      ${copied ? copiedLabel : '📋 ' + label}
    </button>`;
};

// Avatar picker grid
export const AvatarPicker = ({ value, onChange }) =>
  html`<div class="avatar-picker">
    ${AVATARS.map((a) => html`
      <button type="button"
              class=${value === a ? 'selected' : ''}
              onClick=${() => onChange(a)}>${a}</button>`)}
  </div>`;
