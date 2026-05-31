// Entry point. Boot WS, render root component.

import { html } from './lib.js';
import { render } from 'preact';
import { route, connected } from './store.js';
import { connectWS } from './ws.js';
import { Home } from './views/Home.js';
import { Event } from './views/Event.js';
import { ToastStack, XpFloats } from './components/effects.js';

connectWS();

const Root = () => {
  const r = route.value;
  let view;
  if (r.view === 'event' && r.eventCode) {
    view = html`<${Event} code=${r.eventCode} />`;
  } else {
    view = html`<${Home} />`;
  }

  return html`
    <div class="app">
      ${view}
      <${ToastStack} />
      <${XpFloats} />
      <span class=${`conn-dot ${connected.value ? '' : 'disconnected'}`}
            title=${connected.value ? '已连接' : '连接中…'} />
    </div>`;
};

render(html`<${Root} />`, document.getElementById('app'));
