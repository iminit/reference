import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const CURRICULUM_PATH = path.join(__dirname, 'curriculum.json');

const HOST_TOKEN = process.env.HOST_TOKEN ?? Math.random().toString(36).slice(2, 8).toUpperCase();

// ============================================================================
//  State (in-memory, single event)
// ============================================================================

const curriculum = JSON.parse(fs.readFileSync(CURRICULUM_PATH, 'utf-8'));

const state = {
  status: 'lobby',                  // lobby | running | finale | finished
  activeNodeIdx: -1,                // -1 = not started yet
  countdownEnd: null,               // epoch ms; null = no countdown
  nodes: curriculum.map((n) => ({
    ...n,
    fsmState: 'locked',             // locked | reveal | open | voting | result | done
    openedAt: null,
    closedAt: null,
  })),
  participants: new Map(),          // id -> participant
  submissions: [],                  // [{id, nodeIdx, participantId, content, isFirst, voteCount, createdAt}]
  votes: new Map(),                 // nodeIdx -> Map<voterId, Set<submissionId>>
};

// ============================================================================
//  Helpers
// ============================================================================

function participantsArr() {
  return Array.from(state.participants.values());
}

function getLeaderboard() {
  return participantsArr()
    .filter((p) => !p.isHost)
    .sort((a, b) => b.xp - a.xp || a.joinedAt - b.joinedAt)
    .map((p, idx) => ({ ...p, rank: idx + 1 }));
}

function snapshot() {
  return {
    status: state.status,
    activeNodeIdx: state.activeNodeIdx,
    countdownEnd: state.countdownEnd,
    serverTime: Date.now(),
    nodes: state.nodes,
    participants: participantsArr(),
    submissions: state.submissions,
    leaderboard: getLeaderboard(),
  };
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(data);
  });
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function pushState() {
  broadcast({ type: 'state', state: snapshot() });
}

function addBadge(participant, slug, emoji, name) {
  if (!participant) return;
  if (participant.badges.find((b) => b.slug === slug)) return;
  participant.badges.push({ slug, emoji, name, awardedAt: Date.now() });
  broadcast({ type: 'badge:awarded', participantId: participant.id, badge: { slug, emoji, name } });
}

// ============================================================================
//  Handlers
// ============================================================================

function handleJoin(ws, { name, avatar }) {
  const cleanName = String(name || '').trim().slice(0, 16);
  if (!cleanName) return;

  let id = ws.participantId;
  if (!id) {
    id = randomUUID();
    ws.participantId = id;
  }

  const existing = state.participants.get(id);
  state.participants.set(id, {
    id,
    name: cleanName,
    avatar: avatar || '🦊',
    xp: existing?.xp ?? 0,
    streak: existing?.streak ?? 0,
    badges: existing?.badges ?? [],
    online: true,
    isHost: false,
    joinedAt: existing?.joinedAt ?? Date.now(),
  });

  send(ws, { type: 'joined', id, name: cleanName, avatar: avatar || '🦊' });
  pushState();
}

function handleHostClaim(ws, { token }) {
  if (String(token).toUpperCase() !== HOST_TOKEN.toUpperCase()) {
    send(ws, { type: 'host:denied', message: '主持人令牌无效' });
    return;
  }
  ws.isHost = true;
  ws.participantId = 'host';
  send(ws, { type: 'host:granted' });
  pushState();
}

function handleSubmit(ws, { content }) {
  if (!ws.participantId || ws.isHost) return;
  if (state.activeNodeIdx < 0) return;

  const node = state.nodes[state.activeNodeIdx];
  if (!node || node.fsmState !== 'open') return;

  const cleanContent = String(content || '').trim().slice(0, 5000);
  if (cleanContent.length < 1) return;

  // Same user re-submits = update
  const existingIdx = state.submissions.findIndex(
    (s) => s.nodeIdx === state.activeNodeIdx && s.participantId === ws.participantId
  );
  if (existingIdx >= 0) {
    state.submissions[existingIdx] = {
      ...state.submissions[existingIdx],
      content: cleanContent,
      updatedAt: Date.now(),
    };
    pushState();
    return;
  }

  // First submitter for this node?
  const isFirst = !state.submissions.some((s) => s.nodeIdx === state.activeNodeIdx);

  const sub = {
    id: randomUUID(),
    nodeIdx: state.activeNodeIdx,
    participantId: ws.participantId,
    content: cleanContent,
    isFirst,
    voteCount: 0,
    voters: [],
    createdAt: Date.now(),
  };
  state.submissions.push(sub);

  // XP calculation
  const participant = state.participants.get(ws.participantId);
  if (participant) {
    const submittedSoFar = state.submissions.filter((s) => s.nodeIdx === state.activeNodeIdx).length;
    let xpGain = 100; // base
    if (submittedSoFar === 1) xpGain += 50;
    else if (submittedSoFar <= 3) xpGain += 30;
    else if (submittedSoFar <= 10) xpGain += 15;

    // Difficulty multiplier
    const diffMult = 1.0 + Math.max(0, node.difficulty - 1) * 0.1;
    xpGain = Math.round(xpGain * diffMult);

    participant.xp += xpGain;

    if (isFirst) {
      addBadge(participant, 'lightning', '⚡', '闪电');
      participant.firstCount = (participant.firstCount ?? 0) + 1;
      if (participant.firstCount === 3) addBadge(participant, 'triple-lightning', '⚡⚡⚡', '闪电×3');
      if (participant.firstCount === 5) addBadge(participant, 'speed-king', '🏆', '极速王');
    }

    broadcast({
      type: 'xp:update',
      participantId: participant.id,
      gain: xpGain,
      total: participant.xp,
    });
  }

  broadcast({ type: 'submission:new', submission: sub });
  pushState();
}

function handleVote(ws, { submissionId }) {
  if (!ws.participantId || ws.isHost) return;
  if (state.activeNodeIdx < 0) return;

  const node = state.nodes[state.activeNodeIdx];
  if (!node || node.fsmState !== 'voting') return;

  const sub = state.submissions.find((s) => s.id === submissionId);
  if (!sub) return;
  if (sub.nodeIdx !== state.activeNodeIdx) return;
  if (sub.participantId === ws.participantId) return; // no self-vote

  let nodeVotes = state.votes.get(state.activeNodeIdx);
  if (!nodeVotes) {
    nodeVotes = new Map();
    state.votes.set(state.activeNodeIdx, nodeVotes);
  }
  let myVotes = nodeVotes.get(ws.participantId);
  if (!myVotes) {
    myVotes = new Set();
    nodeVotes.set(ws.participantId, myVotes);
  }

  if (myVotes.has(submissionId)) return; // already voted for this
  if (myVotes.size >= 3) return; // 3 votes per node max

  myVotes.add(submissionId);
  sub.voteCount += 1;
  sub.voters.push(ws.participantId);

  // XP for receiver
  const receiver = state.participants.get(sub.participantId);
  if (receiver) {
    const xpGain = 30;
    receiver.xp += xpGain;
    broadcast({
      type: 'xp:update',
      participantId: receiver.id,
      gain: xpGain,
      total: receiver.xp,
    });

    if (sub.voteCount === 3) addBadge(receiver, 'seen', '👀', '被看见');
    if (sub.voteCount === 5) addBadge(receiver, 'crowd-fav', '⭐', '人气王');
  }

  // Voter generosity badges
  const voter = state.participants.get(ws.participantId);
  if (voter) {
    const totalVotesCast = Array.from(state.votes.values()).reduce(
      (sum, nodeMap) => sum + (nodeMap.get(ws.participantId)?.size ?? 0),
      0
    );
    if (totalVotesCast === 20) addBadge(voter, 'jury', '⚖️', '评审团');
    if (totalVotesCast === 60) addBadge(voter, 'super-jury', '💎', '资深评审');
  }

  broadcast({
    type: 'vote:cast',
    submissionId,
    voterId: ws.participantId,
    voteCount: sub.voteCount,
  });
}

function applyNodeResults(idx) {
  const subs = state.submissions
    .filter((s) => s.nodeIdx === idx)
    .sort((a, b) => b.voteCount - a.voteCount);

  subs.forEach((s, rank) => {
    s.finalRank = rank + 1;
    const p = state.participants.get(s.participantId);
    if (!p) return;
    if (rank === 0 && s.voteCount > 0) {
      p.xp += 50;
      addBadge(p, 'top-of-node', '🏆', '节点冠军');
    } else if (rank === 1 && s.voteCount > 0) {
      p.xp += 30;
    } else if (rank === 2 && s.voteCount > 0) {
      p.xp += 15;
    }
  });

  // Streak update
  const submittedIds = new Set(subs.map((s) => s.participantId));
  state.participants.forEach((p) => {
    if (p.isHost) return;
    if (submittedIds.has(p.id)) {
      p.streak = (p.streak ?? 0) + 1;
      if (p.streak === 3) addBadge(p, 'puppy', '🐕', '小猎犬');
      if (p.streak === 7) addBadge(p, 'climber', '🏔️', '稳步攀登者');
      if (p.streak === 12) addBadge(p, 'flow-master', '🧘', '心流大师');
      if (p.streak === 20) addBadge(p, 'perfect', '🌟', '全勤先锋');
    } else {
      p.streak = Math.max(0, (p.streak ?? 0) - 1);
    }
  });
}

function applyFinaleAwards() {
  const lb = getLeaderboard();
  if (lb[0]) addBadge(state.participants.get(lb[0].id), 'gold', '🥇', 'AI 应用先锋');
  if (lb[1]) addBadge(state.participants.get(lb[1].id), 'silver', '🥈', '亚军徽');
  if (lb[2]) addBadge(state.participants.get(lb[2].id), 'bronze', '🥉', '季军徽');
}

function handleHostTransition(ws, { transition }) {
  if (!ws.isHost) return;
  const idx = state.activeNodeIdx;
  const node = idx >= 0 ? state.nodes[idx] : null;

  switch (transition) {
    case 'start_event':
      if (state.status === 'lobby') {
        state.status = 'running';
        state.activeNodeIdx = 0;
        state.nodes[0].fsmState = 'reveal';
      }
      break;
    case 'publish':
      if (node && node.fsmState === 'locked') node.fsmState = 'reveal';
      break;
    case 'open':
      if (node && node.fsmState === 'reveal') {
        node.fsmState = 'open';
        node.openedAt = Date.now();
        state.countdownEnd = Date.now() + node.durationSec * 1000;
      }
      break;
    case 'close':
      if (node && node.fsmState === 'open') {
        node.fsmState = 'voting';
        node.closedAt = Date.now();
        state.countdownEnd = Date.now() + 60 * 1000;
      }
      break;
    case 'reveal_result':
      if (node && node.fsmState === 'voting') {
        node.fsmState = 'result';
        state.countdownEnd = null;
        applyNodeResults(idx);
      }
      break;
    case 'advance':
      if (node && (node.fsmState === 'result' || node.fsmState === 'voting' || node.fsmState === 'open')) {
        if (node.fsmState !== 'result') applyNodeResults(idx);
        node.fsmState = 'done';
        if (idx + 1 < state.nodes.length) {
          state.activeNodeIdx = idx + 1;
          state.nodes[idx + 1].fsmState = 'reveal';
          state.countdownEnd = null;
        } else {
          state.status = 'finale';
          state.countdownEnd = null;
          applyFinaleAwards();
        }
      }
      break;
    case 'finish':
      state.status = 'finished';
      state.countdownEnd = null;
      break;
    case 'reset':
      resetEvent();
      break;
  }
  pushState();
}

function handleHostExtend(ws, { seconds = 60 }) {
  if (!ws.isHost) return;
  if (state.countdownEnd) {
    state.countdownEnd += seconds * 1000;
    pushState();
  }
}

function handleHostPause(ws) {
  if (!ws.isHost) return;
  if (state.countdownEnd) {
    state.pausedRemaining = Math.max(0, state.countdownEnd - Date.now());
    state.countdownEnd = null;
    pushState();
  }
}

function handleHostResume(ws) {
  if (!ws.isHost) return;
  if (state.pausedRemaining != null) {
    state.countdownEnd = Date.now() + state.pausedRemaining;
    delete state.pausedRemaining;
    pushState();
  }
}

function resetEvent() {
  state.status = 'lobby';
  state.activeNodeIdx = -1;
  state.countdownEnd = null;
  delete state.pausedRemaining;
  state.nodes.forEach((n) => {
    n.fsmState = 'locked';
    n.openedAt = null;
    n.closedAt = null;
  });
  state.submissions = [];
  state.votes.clear();
  state.participants.forEach((p) => {
    if (!p.isHost) {
      p.xp = 0;
      p.streak = 0;
      p.badges = [];
      p.firstCount = 0;
    }
  });
}

// ============================================================================
//  Timer (auto-close on countdown end)
// ============================================================================

setInterval(() => {
  if (!state.countdownEnd) return;
  if (Date.now() < state.countdownEnd) return;

  const idx = state.activeNodeIdx;
  if (idx < 0) return;
  const node = state.nodes[idx];
  if (!node) return;

  if (node.fsmState === 'open') {
    node.fsmState = 'voting';
    node.closedAt = Date.now();
    state.countdownEnd = Date.now() + 60 * 1000;
    pushState();
  } else if (node.fsmState === 'voting') {
    node.fsmState = 'result';
    state.countdownEnd = null;
    applyNodeResults(idx);
    pushState();
  }
}, 500);

// ============================================================================
//  HTTP
// ============================================================================

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  if (url === '/host') url = '/host.html';

  const filePath = path.join(PUBLIC_DIR, url);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  send(ws, { type: 'state', state: snapshot() });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case 'join':              handleJoin(ws, msg); break;
      case 'host:claim':        handleHostClaim(ws, msg); break;
      case 'submit':            handleSubmit(ws, msg); break;
      case 'vote':              handleVote(ws, msg); break;
      case 'host:transition':   handleHostTransition(ws, msg); break;
      case 'host:extend':       handleHostExtend(ws, msg); break;
      case 'host:pause':        handleHostPause(ws); break;
      case 'host:resume':       handleHostResume(ws); break;
      case 'ping':              send(ws, { type: 'pong', t: Date.now() }); break;
    }
  });

  ws.on('close', () => {
    if (ws.participantId && ws.participantId !== 'host') {
      const p = state.participants.get(ws.participantId);
      if (p) {
        p.online = false;
        broadcast({ type: 'presence:update', participants: participantsArr() });
      }
    }
  });
});

server.listen(PORT, () => {
  const banner = `
  ╔═══════════════════════════════════════════════════╗
  ║   ⚡  LightningClass · AI 实践通关训练营             ║
  ╠═══════════════════════════════════════════════════╣
  ║                                                    ║
  ║   学员入口:    http://localhost:${PORT}                 ║
  ║   主持人台:    http://localhost:${PORT}/host            ║
  ║                                                    ║
  ║   主持人令牌:  ${HOST_TOKEN.padEnd(35)} ║
  ║                                                    ║
  ║   把上面的"学员入口"分享给你的培训对象              ║
  ║   主持人令牌只发给自己（用于打开主持人台）          ║
  ║                                                    ║
  ╚═══════════════════════════════════════════════════╝
`;
  console.log(banner);
});
