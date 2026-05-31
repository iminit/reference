// Visual side-effects: toast stack, floating XP, confetti — rendered into DOM.
import { html } from '../lib.js';
import { toasts, xpEffects } from '../store.js';

export const ToastStack = () =>
  html`<div class="toast-stack">
    ${toasts.value.map((t) => html`
      <div class="toast" key=${t.id}>
        <span class="toast-icon">${t.icon}</span>
        <div>
          <div>${t.title}</div>
          ${t.desc && html`<div class="toast-desc">${t.desc}</div>`}
        </div>
      </div>`)}
  </div>`;

export const XpFloats = () =>
  html`<>
    ${xpEffects.value.map((e) => html`
      <div class="xp-float" key=${e.id} style=${{ left: `${e.x}px`, top: `${e.y}px` }}>
        +${e.amount} XP
      </div>`)}
  </>`;
