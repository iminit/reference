// =============================================================================
//  LightningClass · Learner Client
// =============================================================================

const AVATARS = ['🦊', '🐻', '🦁', '🐯', '🐰', '🐼', '🐨', '🐸',
                 '🐧', '🦉', '🦄', '🐱', '🐶', '🐹', '🐢', '🦋'];

const state = {
  ws: null,
  me: null,                          // {id, name, avatar}
  serverState: null,
  myVotesByNode: {},                 // nodeIdx -> Set of submissionIds
  countdownInterval: null,
  selectedAvatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
};

// =============================================================================
//  Utilities
// =============================================================================

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function show(viewId) {
  $$('section').forEach(s => s.classList.add('hidden'));
  $(viewId).classList.remove('hidden');
}

function send(msg) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(msg));
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeSince(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s 前`;
  return `${Math.floor(sec / 60)}m 前`;
}

function fmtCountdown(remainingMs) {
  if (remainingMs <= 0) return '00:00';
  const s = Math.ceil(remainingMs / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}

// =============================================================================
//  Avatar picker
// =============================================================================

function renderAvatarPicker() {
  const container = $('avatar-picker');
  container.innerHTML = '';
  AVATARS.forEach(a => {
    const btn = document.createElement('button');
    btn.textContent = a;
    btn.type = 'button';
    if (a === state.selectedAvatar) btn.classList.add('selected');
    btn.onclick = () => {
      state.selectedAvatar = a;
      renderAvatarPicker();
    };
    container.appendChild(btn);
  });
}

// =============================================================================
//  WebSocket connection
// =============================================================================

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}`;
  state.ws = new WebSocket(url);

  state.ws.onopen = () => {
    // If we already had identity (e.g. reload), rejoin
    const saved = localStorage.getItem('lc_me');
    if (saved) {
      try {
        const me = JSON.parse(saved);
        state.me = me;
        send({ type: 'join', name: me.name, avatar: me.avatar });
      } catch {}
    }
  };

  state.ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };

  state.ws.onclose = () => {
    setTimeout(connect, 1500);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'state':
      state.serverState = msg.state;
      render();
      break;
    case 'joined':
      state.me = { id: msg.id, name: msg.name, avatar: msg.avatar };
      localStorage.setItem('lc_me', JSON.stringify(state.me));
      break;
    case 'xp:update':
      if (state.me && msg.participantId === state.me.id) {
        // animate XP gain
        floatXp(msg.gain);
        $('play-xp').textContent = msg.total;
      }
      break;
    case 'badge:awarded':
      if (state.me && msg.participantId === state.me.id) {
        showToast(msg.badge);
        burstConfetti();
      }
      break;
    case 'submission:new':
      // re-render via next state push
      if (msg.submission.participantId === state.me?.id) {
        floatXp(150);
      }
      break;
    case 'vote:cast':
      // animation handled in card render via state push
      break;
    case 'host:granted':
    case 'host:denied':
      // not relevant on learner page
      break;
  }
}

// =============================================================================
//  Entry view
// =============================================================================

function setupEntry() {
  renderAvatarPicker();
  $('btn-enter').onclick = () => {
    const name = $('nick').value.trim();
    if (!name) {
      $('nick').focus();
      $('nick').style.borderColor = 'var(--coral)';
      return;
    }
    send({ type: 'join', name, avatar: state.selectedAvatar });
  };
  $('nick').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-enter').click();
  });
}

// =============================================================================
//  Master render (dispatch based on state)
// =============================================================================

function render() {
  const s = state.serverState;
  if (!s) return;

  // If not joined yet but have state, show entry
  if (!state.me) {
    show('view-entry');
    return;
  }

  // Routing by server status
  if (s.status === 'lobby') {
    show('view-lobby');
    renderLobby();
  } else if (s.status === 'running') {
    show('view-play');
    renderPlay();
  } else if (s.status === 'finale' || s.status === 'finished') {
    show('view-finale');
    renderFinale();
  }
}

// =============================================================================
//  Lobby view
// =============================================================================

function renderLobby() {
  const s = state.serverState;
  const learners = s.participants.filter(p => !p.isHost);
  $('lobby-count').textContent = learners.filter(p => p.online).length;

  const roster = $('lobby-roster');
  roster.innerHTML = '';
  learners.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'avatar-chip';
    if (p.id === state.me?.id) chip.classList.add('me');
    if (!p.online) chip.classList.add('offline');
    chip.textContent = p.avatar;
    chip.setAttribute('data-tooltip', p.name);
    roster.appendChild(chip);
  });

  renderTopbarRoster('lobby-topbar-roster');
}

function renderTopbarRoster(elId) {
  const el = $(elId);
  if (!el) return;
  el.innerHTML = '';
  const learners = state.serverState.participants.filter(p => !p.isHost);
  learners.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'avatar-chip';
    if (p.id === state.me?.id) chip.classList.add('me');
    if (!p.online) chip.classList.add('offline');
    chip.textContent = p.avatar;
    chip.setAttribute('data-tooltip', `${p.name} · ${p.xp} XP`);
    el.appendChild(chip);
  });
}

// =============================================================================
//  Play view
// =============================================================================

let lastNodeIdx = -1;
let lastFsmState = '';

function renderPlay() {
  const s = state.serverState;
  if (s.activeNodeIdx < 0) return;
  const node = s.nodes[s.activeNodeIdx];

  renderTopbarRoster('play-topbar-roster');
  renderNodeMap();
  renderNodeHeader(node);

  const me = s.participants.find(p => p.id === state.me?.id);
  if (me) {
    $('play-xp').textContent = me.xp;
    $('play-streak').textContent = me.streak;
  }

  // FSM-driven sub-view
  const transition = lastFsmState !== node.fsmState || lastNodeIdx !== s.activeNodeIdx;

  ['state-reveal', 'state-open', 'state-voting', 'state-result'].forEach(id => {
    $(id).classList.add('hidden');
  });

  if (node.fsmState === 'reveal') {
    $('state-reveal').classList.remove('hidden');
  } else if (node.fsmState === 'open') {
    $('state-open').classList.remove('hidden');
    renderOpenState(node);
  } else if (node.fsmState === 'voting') {
    $('state-voting').classList.remove('hidden');
    renderVotingState(node);
  } else if (node.fsmState === 'result') {
    $('state-result').classList.remove('hidden');
    renderResultState(node);
  }

  // Countdown
  updateCountdown();

  // Vote bar
  if (node.fsmState === 'voting') {
    $('vote-bar').classList.remove('hidden');
    renderVoteTokens(s.activeNodeIdx);
  } else {
    $('vote-bar').classList.add('hidden');
  }

  lastFsmState = node.fsmState;
  lastNodeIdx = s.activeNodeIdx;
}

function renderNodeMap() {
  const s = state.serverState;
  const map = $('node-map');
  map.innerHTML = '';
  s.nodes.forEach((n, idx) => {
    const dot = document.createElement('div');
    dot.className = 'node-dot';
    if (n.fsmState === 'done') dot.classList.add('done');
    if (idx === s.activeNodeIdx) dot.classList.add('active');
    dot.textContent = idx === s.activeNodeIdx ? n.icon : (n.fsmState === 'done' ? '✓' : (idx + 1));
    map.appendChild(dot);
  });
}

function renderNodeHeader(node) {
  $('play-event-title').textContent = `Node ${node.seq}`;
  $('node-icon').textContent = node.icon;
  $('node-phase').textContent = `${node.phaseName} · Node ${node.seq}/20`;
  $('node-title').textContent = node.title;
  $('node-diff').textContent = '★'.repeat(node.difficulty) + ` · ${node.durationSec}s`;
  $('node-question').textContent = node.question;

  $('node-header').className = `node-header accent-${node.accent}`;

  // tools
  const tools = $('node-tools');
  tools.innerHTML = '';
  node.tools.forEach(t => {
    const tag = document.createElement('span');
    tag.className = 'tool-tag';
    tag.textContent = t;
    tools.appendChild(tag);
  });

  // warning
  if (node.warning) {
    $('node-warning').classList.remove('hidden');
    $('node-warning').innerHTML = `⚠️ ${escapeHTML(node.warning)}`;
  } else {
    $('node-warning').classList.add('hidden');
  }

  // prompt template
  if (node.promptTemplate) {
    $('prompt-block').classList.remove('hidden');
    const filled = node.promptTemplate.replace(/{name}/g, state.me?.name ?? '');
    $('prompt-content').textContent = filled;
    $('copy-prompt').onclick = () => {
      navigator.clipboard.writeText(filled);
      $('copy-prompt').classList.add('copied');
      $('copy-prompt').textContent = '✓ 已复制';
      setTimeout(() => {
        $('copy-prompt').classList.remove('copied');
        $('copy-prompt').textContent = '📋 一键复制';
      }, 2000);
    };
  } else {
    $('prompt-block').classList.add('hidden');
  }

  // external link
  if (node.externalLink) {
    $('node-external').classList.remove('hidden');
    $('external-link').href = node.externalLink;
  } else {
    $('node-external').classList.add('hidden');
  }
}

function renderOpenState(node) {
  // input
  const input = $('submit-input');
  input.placeholder = node.placeholder || '把 AI 的回答粘贴到这里…';
  input.oninput = () => {
    $('char-count').textContent = input.value.length;
  };

  // check if I already submitted
  const mySub = state.serverState.submissions.find(
    s => s.nodeIdx === state.serverState.activeNodeIdx && s.participantId === state.me?.id
  );
  if (mySub) {
    input.value = mySub.content;
    $('char-count').textContent = mySub.content.length;
    $('submit-status').textContent = '✓ 已提交（可修改后再提交覆盖）';
    $('btn-submit').textContent = '🔄 更新提交';
  } else {
    if (input.value === '' || input.disabled) input.value = '';
    $('char-count').textContent = '0';
    $('submit-status').textContent = '';
    $('btn-submit').textContent = '⚡ 提交';
  }
  input.disabled = false;
  $('btn-submit').disabled = false;
  $('btn-submit').onclick = () => {
    const content = input.value.trim();
    if (!content) return;
    send({ type: 'submit', content });
    $('submit-status').textContent = '⚡ 提交中…';
  };

  // waterfall (newest first)
  const subs = state.serverState.submissions
    .filter(s => s.nodeIdx === state.serverState.activeNodeIdx)
    .sort((a, b) => b.createdAt - a.createdAt);

  $('open-sub-count').textContent = subs.length;
  const list = $('open-sub-list');
  list.innerHTML = '';
  subs.forEach(s => list.appendChild(renderSubCard(s, { showVote: false })));
}

function renderVotingState(node) {
  const subs = state.serverState.submissions
    .filter(s => s.nodeIdx === state.serverState.activeNodeIdx)
    .sort((a, b) => b.createdAt - a.createdAt);

  $('voting-sub-count').textContent = subs.length;
  const list = $('voting-sub-list');
  list.innerHTML = '';
  subs.forEach(s => list.appendChild(renderSubCard(s, { showVote: true })));
}

function renderResultState(node) {
  const subs = state.serverState.submissions
    .filter(s => s.nodeIdx === state.serverState.activeNodeIdx)
    .sort((a, b) => b.voteCount - a.voteCount);

  const list = $('result-sub-list');
  list.innerHTML = '';
  subs.forEach((s, rank) => list.appendChild(renderSubCard(s, { showVote: false, rank: rank + 1 })));
}

function renderSubCard(sub, { showVote = false, rank = null } = {}) {
  const s = state.serverState;
  const author = s.participants.find(p => p.id === sub.participantId);
  if (!author) return document.createDocumentFragment();

  const card = document.createElement('div');
  card.className = 'sub-card';
  if (sub.participantId === state.me?.id) card.classList.add('mine');
  if (rank) card.classList.add(`rank-${rank}`);

  const head = document.createElement('div');
  head.className = 'sub-card-head';

  const authorBox = document.createElement('div');
  authorBox.className = 'sub-author';

  if (rank && rank <= 3) {
    const rb = document.createElement('div');
    rb.className = `rank-badge r${rank}`;
    rb.textContent = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
    authorBox.appendChild(rb);
  }

  const avatar = document.createElement('div');
  avatar.className = 'avatar-chip';
  avatar.textContent = author.avatar;
  authorBox.appendChild(avatar);

  const name = document.createElement('span');
  name.className = 'sub-author-name';
  name.textContent = author.name;
  authorBox.appendChild(name);

  if (sub.isFirst) {
    const badge = document.createElement('span');
    badge.className = 'sub-badge';
    badge.innerHTML = '⚡ 首位';
    authorBox.appendChild(badge);
  }

  head.appendChild(authorBox);

  const time = document.createElement('span');
  time.className = 'sub-time';
  time.textContent = timeSince(sub.createdAt);
  head.appendChild(time);

  card.appendChild(head);

  const content = document.createElement('div');
  content.className = 'sub-content';
  content.textContent = sub.content;
  card.appendChild(content);

  const foot = document.createElement('div');
  foot.className = 'sub-foot';

  if (showVote) {
    const isMine = sub.participantId === state.me?.id;
    const myVotes = state.myVotesByNode[sub.nodeIdx] || new Set();
    const hasVoted = myVotes.has(sub.id) || (sub.voters && sub.voters.includes(state.me?.id));
    const votesUsed = sub.voters ? sub.voters.filter(v => v === state.me?.id).length : 0;
    const totalMyVotes = state.serverState.submissions
      .filter(ss => ss.nodeIdx === sub.nodeIdx)
      .reduce((sum, ss) => sum + (ss.voters?.filter(v => v === state.me?.id).length || 0), 0);

    const btn = document.createElement('button');
    btn.className = 'vote-btn';
    if (hasVoted) btn.classList.add('voted');
    btn.innerHTML = `${hasVoted ? '❤️' : '🤍'} <span>${hasVoted ? '已投' : '投一票'}</span>`;
    btn.disabled = isMine || hasVoted || totalMyVotes >= 3;
    if (isMine) btn.innerHTML = '🪞 这是你';
    btn.onclick = () => {
      send({ type: 'vote', submissionId: sub.id });
      // optimistic UI
      btn.classList.add('voted');
      btn.disabled = true;
      btn.innerHTML = '❤️ <span>已投</span>';
    };
    foot.appendChild(btn);
  } else {
    const stub = document.createElement('span');
    stub.className = 'text-mute text-sm';
    foot.appendChild(stub);
  }

  const counter = document.createElement('span');
  counter.className = 'vote-count';
  counter.innerHTML = `❤ ${sub.voteCount}`;
  foot.appendChild(counter);

  card.appendChild(foot);
  return card;
}

function renderVoteTokens(nodeIdx) {
  const totalUsed = state.serverState.submissions
    .filter(s => s.nodeIdx === nodeIdx)
    .reduce((sum, s) => sum + (s.voters?.filter(v => v === state.me?.id).length || 0), 0);

  const tokens = $$('#vote-tokens .vote-token');
  tokens.forEach((t, i) => {
    if (i < totalUsed) t.classList.add('used');
    else t.classList.remove('used');
  });
}

// =============================================================================
//  Countdown
// =============================================================================

function updateCountdown() {
  if (state.countdownInterval) clearInterval(state.countdownInterval);

  const tick = () => {
    const cd = state.serverState?.countdownEnd;
    if (!cd) {
      $('node-countdown').classList.add('hidden');
      return;
    }
    const remaining = cd - Date.now();
    if (remaining <= 0) {
      $('countdown-num').textContent = '00:00';
    } else {
      $('countdown-num').textContent = fmtCountdown(remaining);
    }
    $('node-countdown').classList.remove('hidden');
    if (remaining < 15000 && remaining > 0) $('node-countdown').classList.add('urgent');
    else $('node-countdown').classList.remove('urgent');
  };
  tick();
  state.countdownInterval = setInterval(tick, 500);
}

// =============================================================================
//  Finale view
// =============================================================================

function renderFinale() {
  const s = state.serverState;
  const lb = s.leaderboard;
  const me = s.participants.find(p => p.id === state.me?.id);

  // Stats
  const totalSubs = s.submissions.length;
  const totalVotes = s.submissions.reduce((sum, s) => sum + s.voteCount, 0);
  const totalBadges = s.participants.reduce((sum, p) => sum + p.badges.length, 0);
  const totalLearners = s.participants.filter(p => !p.isHost).length;

  $('finale-stats').innerHTML = `
    <div class="finale-stat"><div class="finale-stat-num">${totalLearners}</div><div class="finale-stat-label">勇士</div></div>
    <div class="finale-stat"><div class="finale-stat-num">${totalSubs}</div><div class="finale-stat-label">提交</div></div>
    <div class="finale-stat"><div class="finale-stat-num">${totalVotes}</div><div class="finale-stat-label">总票数</div></div>
    <div class="finale-stat"><div class="finale-stat-num">${totalBadges}</div><div class="finale-stat-label">徽章解锁</div></div>
  `;

  // Podium
  const podium = $('podium');
  podium.innerHTML = '';
  const top3 = lb.slice(0, 3);
  const order = [1, 0, 2]; // render 2nd, 1st, 3rd left to right
  order.forEach(i => {
    if (!top3[i]) return;
    const p = top3[i];
    const rank = i + 1;
    const div = document.createElement('div');
    div.className = `podium-spot spot-${rank}`;
    div.innerHTML = `
      <div class="podium-avatar">${p.avatar}</div>
      <div class="podium-name">${escapeHTML(p.name)}</div>
      <div class="podium-xp">${p.xp} XP</div>
      <div class="podium-block">
        <div class="medal">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</div>
        ${rank}
      </div>
    `;
    podium.appendChild(div);
  });

  // My summary
  if (me) {
    const myRank = lb.find(p => p.id === me.id)?.rank ?? '-';
    const mySubs = s.submissions.filter(ss => ss.participantId === me.id);
    const myVotes = mySubs.reduce((sum, ss) => sum + ss.voteCount, 0);

    let badgeHtml = '';
    me.badges.forEach(b => {
      badgeHtml += `<span class="badge-chip">${b.emoji} ${escapeHTML(b.name)}</span>`;
    });
    if (!badgeHtml) badgeHtml = '<span class="text-mute text-sm">这次没拿徽章 · 下次努力 🌱</span>';

    $('my-summary').innerHTML = `
      <h3>${me.avatar} ${escapeHTML(me.name)} · 你的战绩</h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0">
        <div class="card-soft center">
          <div style="font-family:var(--font-num);font-size:22px;font-weight:800">#${myRank}</div>
          <div class="text-sm text-mute">排名</div>
        </div>
        <div class="card-soft center">
          <div style="font-family:var(--font-num);font-size:22px;font-weight:800;color:var(--peach-deep)">${me.xp}</div>
          <div class="text-sm text-mute">XP</div>
        </div>
        <div class="card-soft center">
          <div style="font-family:var(--font-num);font-size:22px;font-weight:800;color:var(--sky-deep)">${mySubs.length}</div>
          <div class="text-sm text-mute">提交</div>
        </div>
        <div class="card-soft center">
          <div style="font-family:var(--font-num);font-size:22px;font-weight:800;color:var(--coral-deep)">${myVotes}</div>
          <div class="text-sm text-mute">获票</div>
        </div>
      </div>
      <div><strong>你解锁的徽章</strong></div>
      <div class="my-badges">${badgeHtml}</div>
    `;
  }

  // Confetti burst on first render
  if (!state._finaleConfettiDone) {
    state._finaleConfettiDone = true;
    setTimeout(() => burstConfetti(60), 500);
    setTimeout(() => burstConfetti(60), 1500);
    setTimeout(() => burstConfetti(80), 3000);
  }
}

// =============================================================================
//  Effects: confetti, XP float, badge toast
// =============================================================================

function burstConfetti(count = 40) {
  const colors = ['#FF7A59', '#FFD23F', '#3ABFF8', '#FF6B8A', '#A78BFA'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDelay = `${Math.random() * 0.5}s`;
    p.style.animationDuration = `${2 + Math.random() * 2}s`;
    if (Math.random() < 0.3) p.style.borderRadius = '50%';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 4000);
  }
}

function floatXp(amount) {
  const el = document.createElement('div');
  el.className = 'xp-float';
  el.textContent = `+${amount} XP`;
  const xpPill = $('play-xp');
  if (xpPill) {
    const rect = xpPill.getBoundingClientRect();
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = `${rect.top}px`;
  } else {
    el.style.left = '50%';
    el.style.top = '50%';
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

const toastQueue = [];
let toastShowing = false;

function showToast(badge) {
  toastQueue.push(badge);
  if (!toastShowing) processToastQueue();
}

function processToastQueue() {
  if (toastQueue.length === 0) {
    toastShowing = false;
    return;
  }
  toastShowing = true;
  const badge = toastQueue.shift();
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `
    <span class="icon">${badge.emoji}</span>
    <div>
      <div>你解锁了 <span class="badge-name">${escapeHTML(badge.name)}</span></div>
      <div class="desc">徽章 · ${escapeHTML(badge.slug)}</div>
    </div>
  `;
  $('toast-stack').appendChild(t);
  setTimeout(() => t.classList.add('leaving'), 3000);
  setTimeout(() => { t.remove(); processToastQueue(); }, 3300);
}

// =============================================================================
//  Boot
// =============================================================================

setupEntry();
connect();
