// Entry: learner picks a nickname + avatar before joining a lobby.

import { html } from '../lib.js';
import { useState } from 'preact/hooks';
import { Button, Mascot, AVATARS, AvatarPicker } from '../components/ui.js';
import { identity, setIdentity } from '../store.js';
import { actions } from '../ws.js';

export const Entry = ({ eventCode, eventName }) => {
  const [name, setName] = useState(identity.value.name ?? '');
  const [avatar, setAvatar] = useState(identity.value.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)]);

  const onSubmit = () => {
    const trimmed = name.trim().slice(0, 16);
    if (!trimmed) return;
    setIdentity({ name: trimmed, avatar });
    actions.joinEvent(eventCode, trimmed, avatar);
  };

  return html`
    <div class="center-stage">
      <div class="hero">
        <${Mascot} size=${64} />
        <h1>即将加入</h1>
        <p class="sub">
          <span class="event-tag">${eventCode}</span>
          ${eventName && html` · ${eventName}`}
        </p>

        <div class="surface surface-padded" style=${{ textAlign: 'left' }}>
          <label class="label" for="learner-name">你的暱称</label>
          <input id="learner-name" class="input input-lg"
                 value=${name}
                 placeholder=${"例如：小风、Linda、阿杰"}
                 maxLength=${16}
                 onInput=${(e) => setName(e.target.value)}
                 onKeyDown=${(e) => e.key === 'Enter' && onSubmit()}
                 autoFocus />

          <div class="label" style=${{ marginTop: 'var(--s-4)' }}>选个头像</div>
          <${AvatarPicker} value=${avatar} onChange=${setAvatar} />

          <${Button} kind="primary" size="lg" block disabled=${!name.trim()} onClick=${onSubmit}>
            进入 →
          <//>
        </div>
      </div>
    </div>`;
};
