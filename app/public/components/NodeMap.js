import { html } from '../lib.js';

export const NodeMap = ({ nodes, activeIdx }) =>
  html`<div class="node-map">
    ${nodes.map((n, idx) => {
      const cls = ['node-dot'];
      if (n.fsmState === 'done') cls.push('done');
      if (idx === activeIdx) cls.push('active');
      return html`<div class=${cls.join(' ')} title=${`${n.seq}. ${n.title}`}>
        ${idx === activeIdx ? n.icon : (n.fsmState === 'done' ? '✓' : (idx + 1))}
      </div>`;
    })}
  </div>`;
