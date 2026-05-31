import { html } from '../lib.js';
import { useState } from 'preact/hooks';
import { QR } from './qr.js';
import { Button, Modal } from './ui.js';

export const ShareCard = ({ code }) => {
  const url = `${location.origin}/e/${code}`;
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  return html`
    <div class="share-card">
      <div class="label">分享给学员</div>
      <div class="share-code">${code}</div>
      <div class="share-qr">
        <${QR} text=${url} size=${180} />
      </div>
      <div style=${{ marginTop: 'var(--s-3)', display: 'flex', gap: 'var(--s-2)' }}>
        <${Button} kind="ghost" size="sm" onClick=${copyLink}>
          ${copied ? '✓ 已复制' : '复制链接'}
        <//>
      </div>
      <div class="text-xs text-mute" style=${{ marginTop: 'var(--s-2)', wordBreak: 'break-all' }}>
        ${url}
      </div>
    </div>`;
};

export const ShareModal = ({ open, onClose, code }) =>
  html`<${Modal} open=${open} onClose=${onClose}>
    <h2>邀请学员加入</h2>
    <${ShareCard} code=${code} />
    <div class="modal-foot">
      <${Button} kind="ghost" onClick=${onClose}>关闭<//>
    </div>
  <//>`;
