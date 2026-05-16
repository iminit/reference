// =============================================================================
//  LightningClass · Host Console
// =============================================================================

const state = {
  ws: null,
  isHost: false,
  serverState: null,
  countdownInterval: null,
};

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function show(viewId) {
  $$('section').forEach(s => s.classList.add('hidden'));
  $(viewId).classList.remove('hidden');
}

function send(msg) {
  if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(msg));
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function fmtCountdown(ms) {
  if (ms == null || ms <= 0) return '--:--';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}

// =============================================================================
//  WS
// =============================================================================

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${proto}//${location.host}`);
  state.ws.onopen = () => {
    const savedToken = sessionStorage.getItem('lc_host_token');
    if (savedToken) send({ type: 'host:claim', token: savedToken });
  };
  state.ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };
  state.ws.onclose = () => setTimeout(connect, 1500);
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'state':
      state.serverState = msg.state;
      render();
      break;
    case 'host:granted':
      state.isHost = true;
      show('view-dashboard');
      render();
      break;
    case 'host:denied':
      sessionStorage.removeItem('lc_host_token');
      $('login-error').style.display = 'block';
      $('login-error').textContent = msg.message || '令牌错误';
      break;
  }
}

// =============================================================================
//  Login
// =============================================================================

$('btn-login').onclick = () => {
  const token = $('token').value.trim();
  if (!token) return;
  sessionStorage.setItem('lc_host_token', token);
  send({ type: 'host:claim', token });
};

$('token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-login').click();
});

// =============================================================================
//  Dashboard render
// =============================================================================

function render() {
  if (!state.isHost) {
    show('view-login');
    return;
  }
  const s = state.serverState;
  if (!s) return;

  // Status pill
  const statusPill = $('status-pill');
  if (s.status === 'lobby') {
    statusPill.className = 'host-state-pill locked';
    statusPill.textContent = '🛋️ 候场中';
  } else if (s.status === 'running') {
    statusPill.className = 'host-state-pill open';
    statusPill.textContent = `▶ Node ${s.activeNodeIdx + 1}/20`;
  } else if (s.status === 'finale') {
    statusPill.className = 'host-state-pill voting';
    statusPill.textContent = '🎉 颁奖典礼';
  } else if (s.status === 'finished') {
    statusPill.className = 'host-state-pill done';
    statusPill.textContent = '✓ 已结束';
  }

  // Main area
  ['host-lobby', 'host-node', 'host-finale'].forEach(id => $(id).classList.add('hidden'));
  if (s.status === 'lobby') {
    $('host-lobby').classList.remove('hidden');
    $('lobby-online').textContent = s.participants.filter(p => !p.isHost && p.online).length;
  } else if (s.status === 'running' && s.activeNodeIdx >= 0) {
    $('host-node').classList.remove('hidden');
    renderNodePanel(s.nodes[s.activeNodeIdx]);
  } else if (s.status === 'finale' || s.status === 'finished') {
    $('host-finale').classList.remove('hidden');
  }

  renderSubFeed();
  renderLeaderboard();
  renderNodeMap();
  renderTip();

  // countdown
  if (state.countdownInterval) clearInterval(state.countdownInterval);
  state.countdownInterval = setInterval(() => {
    $('hn-countdown').textContent = fmtCountdown(s.countdownEnd ? s.countdownEnd - Date.now() : null);
  }, 500);
}

function renderNodePanel(node) {
  const s = state.serverState;
  $('hn-icon').textContent = node.icon;
  $('hn-phase').textContent = `${node.phaseName} · Node ${node.seq}/20`;
  $('hn-title').textContent = node.title;
  $('hn-question').textContent = node.question;

  const statePill = $('hn-state');
  statePill.className = `host-state-pill ${node.fsmState}`;
  statePill.textContent = stateLabel(node.fsmState);

  // Stats
  const learners = s.participants.filter(p => !p.isHost);
  $('hn-online').textContent = learners.filter(p => p.online).length;
  const subs = s.submissions.filter(ss => ss.nodeIdx === s.activeNodeIdx);
  $('hn-submitted').textContent = `${subs.length}/${learners.length}`;
  const totalVotes = subs.reduce((sum, ss) => sum + ss.voteCount, 0);
  $('hn-votes').textContent = totalVotes;

  // Actions based on FSM
  const actions = $('host-actions');
  actions.innerHTML = '';
  const addBtn = (label, cls, transition, holdable = true, opts = {}) => {
    const btn = document.createElement('button');
    btn.className = `btn ${cls}${holdable ? ' btn-hold' : ''}`;
    btn.innerHTML = label;
    if (opts.disabled) btn.disabled = true;
    if (holdable) {
      attachHoldConfirm(btn, () => send({ type: 'host:transition', transition }));
    } else {
      btn.onclick = () => send({ type: 'host:transition', transition });
    }
    if (holdable) {
      const prog = document.createElement('div');
      prog.className = 'hold-progress';
      btn.appendChild(prog);
    }
    actions.appendChild(btn);
    return btn;
  };

  switch (node.fsmState) {
    case 'locked':
      addBtn('📢 公布题目', 'btn-primary', 'publish');
      break;
    case 'reveal':
      addBtn('▶ 开放提交', 'btn-primary', 'open');
      break;
    case 'open':
      addBtn('⏹ 关闭并投票', 'btn-secondary', 'close');
      const ext = document.createElement('button');
      ext.className = 'btn btn-ghost btn-sm';
      ext.innerHTML = '+60秒';
      ext.onclick = () => send({ type: 'host:extend', seconds: 60 });
      actions.appendChild(ext);
      break;
    case 'voting':
      addBtn('🏆 展示榜单', 'btn-primary', 'reveal_result');
      const ext2 = document.createElement('button');
      ext2.className = 'btn btn-ghost btn-sm';
      ext2.innerHTML = '+30秒';
      ext2.onclick = () => send({ type: 'host:extend', seconds: 30 });
      actions.appendChild(ext2);
      break;
    case 'result':
      const isLast = s.activeNodeIdx === s.nodes.length - 1;
      addBtn(isLast ? '🎉 进入颁奖典礼' : '➡ 进入下一关', 'btn-primary', 'advance');
      break;
  }
}

function stateLabel(s) {
  const map = {
    locked: '🔒 LOCKED',
    reveal: '👀 REVEAL',
    open:   '✍️ OPEN',
    voting: '🗳 VOTING',
    result: '🏆 RESULT',
    done:   '✓ DONE',
  };
  return map[s] || s;
}

// Press-and-hold confirmation
function attachHoldConfirm(btn, callback, durationMs = 600) {
  let timer = null;
  let progressTimer = null;
  let progress = 0;
  const progressBar = btn.querySelector('.hold-progress');

  const start = (e) => {
    if (btn.disabled) return;
    e.preventDefault();
    progress = 0;
    if (progressBar) progressBar.style.width = '0%';
    timer = setTimeout(() => {
      callback();
      btn.classList.add('confirmed');
    }, durationMs);
    progressTimer = setInterval(() => {
      progress += 50 / durationMs;
      if (progressBar) progressBar.style.width = `${Math.min(100, progress * 100)}%`;
    }, 50);
  };
  const cancel = () => {
    clearTimeout(timer);
    clearInterval(progressTimer);
    if (progressBar) progressBar.style.width = '0%';
  };

  btn.addEventListener('mousedown', start);
  btn.addEventListener('touchstart', start);
  btn.addEventListener('mouseup', cancel);
  btn.addEventListener('mouseleave', cancel);
  btn.addEventListener('touchend', cancel);
}

function renderSubFeed() {
  const s = state.serverState;
  const subs = s.submissions
    .filter(ss => ss.nodeIdx === s.activeNodeIdx)
    .sort((a, b) => b.createdAt - a.createdAt);

  $('host-feed-count').textContent = `${subs.length} 份 · 时间倒排`;
  const feed = $('host-sub-feed');

  if (subs.length === 0) {
    feed.innerHTML = '<p class="text-mute text-sm center" style="padding:24px">还没有提交…</p>';
    return;
  }

  feed.innerHTML = '';
  subs.forEach((sub, idx) => {
    const author = s.participants.find(p => p.id === sub.participantId);
    if (!author) return;
    const card = document.createElement('div');
    card.className = 'sub-card mb-8';
    if (sub.voteCount >= 3) card.classList.add('rank-1');
    card.innerHTML = `
      <div class="sub-card-head">
        <div class="sub-author">
          <div class="avatar-chip">${author.avatar}</div>
          <span class="sub-author-name">${escapeHTML(author.name)}</span>
          ${sub.isFirst ? '<span class="sub-badge">⚡ 首位</span>' : ''}
        </div>
        <span class="vote-count">❤ ${sub.voteCount}</span>
      </div>
      <div class="sub-content">${escapeHTML(sub.content)}</div>
    `;
    feed.appendChild(card);
  });
}

function renderLeaderboard() {
  const s = state.serverState;
  const list = $('leaderboard-list');
  if (!s.leaderboard.length) {
    list.innerHTML = '<p class="text-mute text-sm center" style="padding:16px">等学员加入…</p>';
    return;
  }
  list.innerHTML = '';
  s.leaderboard.slice(0, 12).forEach(p => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    if (p.rank === 1) row.classList.add('r1');
    const badgeStr = p.badges.slice(0, 3).map(b => b.emoji).join('');
    row.innerHTML = `
      <span class="lb-rank">#${p.rank}</span>
      <div class="avatar-chip" style="width:28px;height:28px;font-size:14px">${p.avatar}</div>
      <span class="lb-name">${escapeHTML(p.name)}</span>
      <span class="lb-badges">${badgeStr}</span>
      <span class="lb-xp">${p.xp}</span>
    `;
    list.appendChild(row);
  });
}

function renderNodeMap() {
  const s = state.serverState;
  const map = $('host-node-map');
  map.innerHTML = '';
  s.nodes.forEach((n, idx) => {
    const dot = document.createElement('div');
    dot.className = 'node-dot';
    if (n.fsmState === 'done') dot.classList.add('done');
    if (idx === s.activeNodeIdx) dot.classList.add('active');
    dot.style.fontSize = '12px';
    dot.textContent = idx === s.activeNodeIdx ? n.icon : (n.fsmState === 'done' ? '✓' : (idx + 1));
    dot.title = `${n.seq}. ${n.title}`;
    map.appendChild(dot);
  });
}

function renderTip() {
  const s = state.serverState;
  const tipEl = $('host-tip');
  if (s.status === 'lobby') {
    tipEl.textContent = '开课前问候 60 秒，介绍 LightningClass 的玩法（提交→投票→揭榜），然后点「开始培训」。';
    return;
  }
  if (s.activeNodeIdx < 0) return;
  const node = s.nodes[s.activeNodeIdx];
  const fsmState = node.fsmState;
  const tips = {
    locked: '📢 这一关是「' + node.title + '」。结合 PPT 简单介绍下 ' + node.tools.join('、') + '，然后点「公布题目」。',
    reveal: '🎤 解读题目要点，提醒「' + (node.warning || '认真思考再下笔') + '」，然后点「开放提交」。',
    open:   '👀 观察右上角实时提交流。30 秒后还没有人提交？口播鼓励：「用上面的一键复制按钮就行～」',
    voting: '🗳 投票阶段。提醒大家：「3 张选票要花在最值得的答案上」。',
    result: '🏆 揭榜。点评前 3 名，分析为什么这个答案能打动大家。',
    done:   '✓ 本关结束，自动进入下一关。',
  };
  tipEl.textContent = tips[fsmState] || '';
}

// Reset + Start
$('btn-reset').onclick = () => {
  if (confirm('确定要重置全场？所有提交和分数会清空。')) {
    send({ type: 'host:transition', transition: 'reset' });
  }
};

$('btn-start').onclick = () => {
  send({ type: 'host:transition', transition: 'start_event' });
};

$('btn-finish').onclick = () => {
  if (confirm('结束培训？')) {
    send({ type: 'host:transition', transition: 'finish' });
  }
};

// Boot
connect();
