// =============================================================================
//  LightningClass · v2 Server
//  - 多事件并行（每个 6 位 code）
//  - 创建者自动成为 host（基于浏览器 client_id，无需令牌）
//  - JSON 持久化（5s 防抖）
//  - 单页 SPA，所有路由都返回 index.html
// =============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { randomUUID, randomBytes } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');
const CURRICULUM_PATH = path.join(__dirname, 'curriculum.json');

// =============================================================================
//  Persistence layer (in-memory mirror + debounced flush)
// =============================================================================

const curriculum = JSON.parse(fs.readFileSync(CURRICULUM_PATH, 'utf-8'));

/** @type {{ events: Record<string, Event>, clients: Record<string, ClientMeta> }} */
const db = {
  events: {},
  clients: {},
};

function loadDb() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    db.events = parsed.events ?? {};
    db.clients = parsed.clients ?? {};
    // Patch up FSM: if countdownEnd is in the past on boot, clear it (host will need to resume)
    for (const ev of Object.values(db.events)) {
      if (ev.countdownEnd && ev.countdownEnd < Date.now()) {
        ev.countdownEnd = null;
        ev.pausedRemaining = null;
      }
    }
    console.log(`✓ Loaded ${Object.keys(db.events).length} events, ${Object.keys(db.clients).length} clients`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('Load warning:', err.message);
  }
}

let flushTimer = null;
let dirty = false;
function markDirty() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 2000);
}
function flush() {
  flushTimer = null;
  if (!dirty) return;
  dirty = false;
  const tmp = DATA_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('Flush failed:', err.message);
  }
}

process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });

// =============================================================================
//  Event factory
// =============================================================================

function newCode() {
  // 6 chars, no ambiguous (0/O/1/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  } while (db.events[code]);
  return code;
}

/**
 * @param {string} hostClientId
 * @param {string} name
 */
function createEvent(hostClientId, name) {
  const code = newCode();
  const event = {
    code,
    name: (name || `LightningClass`).slice(0, 60),
    createdAt: Date.now(),
    hostClientId,
    status: 'lobby',       // lobby | running | finale | finished
    activeNodeIdx: -1,
    countdownEnd: null,
    pausedRemaining: null,
    nodes: curriculum.map((n) => ({
      ...n,
      fsmState: 'locked',   // locked | reveal | open | voting | result | done
      openedAt: null,
      closedAt: null,
    })),
    participants: {},      // clientId -> Participant
    submissions: [],       // {id, nodeIdx, clientId, content, isFirst, voteCount, voters, createdAt, updatedAt}
    votes: {},             // nodeIdx -> { clientId: [submissionId, ...] }
  };
  db.events[code] = event;

  if (!db.clients[hostClientId]) db.clients[hostClientId] = { id: hostClientId, hostingEvents: [] };
  db.clients[hostClientId].hostingEvents = (db.clients[hostClientId].hostingEvents ?? []).concat(code);

  markDirty();
  return event;
}

// =============================================================================
//  Domain logic
// =============================================================================

function publicEvent(event, viewerClientId) {
  const isHost = viewerClientId === event.hostClientId;
  return {
    code: event.code,
    name: event.name,
    createdAt: event.createdAt,
    hostClientId: event.hostClientId,
    status: event.status,
    activeNodeIdx: event.activeNodeIdx,
    countdownEnd: event.countdownEnd,
    pausedRemaining: event.pausedRemaining,
    serverTime: Date.now(),
    isHost,
    nodes: event.nodes,
    participants: Object.values(event.participants),
    submissions: event.submissions,
    leaderboard: getLeaderboard(event),
    yourVotes: event.votes[event.activeNodeIdx]?.[viewerClientId] ?? [],
  };
}

function getLeaderboard(event) {
  return Object.values(event.participants)
    .sort((a, b) => b.xp - a.xp || a.joinedAt - b.joinedAt)
    .map((p, idx) => ({ ...p, rank: idx + 1 }));
}

function joinEvent(event, clientId, name, avatar) {
  if (!event.participants[clientId]) {
    event.participants[clientId] = {
      clientId,
      name: (name || 'Anonymous').slice(0, 16),
      avatar: avatar || '🦊',
      xp: 0,
      streak: 0,
      badges: [],
      online: true,
      joinedAt: Date.now(),
    };
  } else {
    // Update name/avatar if changed
    event.participants[clientId].name = (name || event.participants[clientId].name).slice(0, 16);
    event.participants[clientId].avatar = avatar || event.participants[clientId].avatar;
    event.participants[clientId].online = true;
  }

  // Persist last used name/avatar at client level
  if (!db.clients[clientId]) db.clients[clientId] = { id: clientId, hostingEvents: [] };
  db.clients[clientId].lastName = name;
  db.clients[clientId].lastAvatar = avatar;
  markDirty();
}

function addBadgeOnce(participant, slug, emoji, name, broadcasters) {
  if (!participant) return;
  if (participant.badges.find((b) => b.slug === slug)) return;
  participant.badges.push({ slug, emoji, name, at: Date.now() });
  broadcasters.forEach((b) => b({ type: 'badge:awarded', clientId: participant.clientId, badge: { slug, emoji, name } }));
}

function handleSubmit(event, clientId, content, broadcasters) {
  if (event.activeNodeIdx < 0) return;
  const node = event.nodes[event.activeNodeIdx];
  if (!node || node.fsmState !== 'open') return;

  const clean = String(content || '').trim().slice(0, 5000);
  if (!clean) return;

  const existing = event.submissions.find((s) => s.nodeIdx === event.activeNodeIdx && s.clientId === clientId);
  if (existing) {
    existing.content = clean;
    existing.updatedAt = Date.now();
    broadcasters.forEach((b) => b({ type: 'submission:updated', submission: existing }));
    markDirty();
    return;
  }

  const others = event.submissions.filter((s) => s.nodeIdx === event.activeNodeIdx);
  const isFirst = others.length === 0;
  const sub = {
    id: randomUUID(),
    nodeIdx: event.activeNodeIdx,
    clientId,
    content: clean,
    isFirst,
    voteCount: 0,
    voters: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  event.submissions.push(sub);

  const p = event.participants[clientId];
  if (p) {
    const rank = others.length + 1;
    let xp = 100;
    if (rank === 1) xp += 50;
    else if (rank <= 3) xp += 30;
    else if (rank <= 10) xp += 15;
    const diffMult = 1.0 + Math.max(0, node.difficulty - 1) * 0.1;
    xp = Math.round(xp * diffMult);

    p.xp += xp;
    if (isFirst) {
      addBadgeOnce(p, 'lightning', '⚡', '闪电', broadcasters);
      p.firstCount = (p.firstCount ?? 0) + 1;
      if (p.firstCount === 3) addBadgeOnce(p, 'triple-lightning', '⚡⚡⚡', '闪电×3', broadcasters);
      if (p.firstCount === 5) addBadgeOnce(p, 'speed-king', '🏆', '极速王', broadcasters);
    }
    broadcasters.forEach((b) => b({ type: 'xp:gained', clientId, gain: xp, total: p.xp, reason: isFirst ? 'first' : 'submit' }));
  }

  broadcasters.forEach((b) => b({ type: 'submission:added', submission: sub }));
  markDirty();
}

function handleVote(event, clientId, submissionId, broadcasters) {
  if (event.activeNodeIdx < 0) return;
  const node = event.nodes[event.activeNodeIdx];
  if (!node || node.fsmState !== 'voting') return;
  const sub = event.submissions.find((s) => s.id === submissionId);
  if (!sub || sub.nodeIdx !== event.activeNodeIdx) return;
  if (sub.clientId === clientId) return;

  if (!event.votes[event.activeNodeIdx]) event.votes[event.activeNodeIdx] = {};
  if (!event.votes[event.activeNodeIdx][clientId]) event.votes[event.activeNodeIdx][clientId] = [];
  const my = event.votes[event.activeNodeIdx][clientId];

  if (my.includes(submissionId)) return;
  if (my.length >= 3) return;

  my.push(submissionId);
  sub.voteCount += 1;
  sub.voters.push(clientId);

  const receiver = event.participants[sub.clientId];
  if (receiver) {
    receiver.xp += 30;
    broadcasters.forEach((b) => b({ type: 'xp:gained', clientId: receiver.clientId, gain: 30, total: receiver.xp, reason: 'vote' }));
    if (sub.voteCount === 3) addBadgeOnce(receiver, 'seen', '👀', '被看见', broadcasters);
    if (sub.voteCount === 5) addBadgeOnce(receiver, 'crowd-fav', '⭐', '人气王', broadcasters);
  }

  // Voter generosity
  const voter = event.participants[clientId];
  if (voter) {
    let total = 0;
    for (const m of Object.values(event.votes)) total += m[clientId]?.length ?? 0;
    if (total === 20) addBadgeOnce(voter, 'jury', '⚖️', '评审团', broadcasters);
    if (total === 60) addBadgeOnce(voter, 'super-jury', '💎', '资深评审', broadcasters);
  }

  broadcasters.forEach((b) => b({ type: 'vote:added', submissionId, clientId, voteCount: sub.voteCount }));
  markDirty();
}

function handleUnvote(event, clientId, submissionId) {
  if (event.activeNodeIdx < 0) return;
  const node = event.nodes[event.activeNodeIdx];
  if (!node || node.fsmState !== 'voting') return;
  const my = event.votes[event.activeNodeIdx]?.[clientId];
  if (!my) return;
  const i = my.indexOf(submissionId);
  if (i < 0) return;
  my.splice(i, 1);
  const sub = event.submissions.find((s) => s.id === submissionId);
  if (sub) {
    sub.voteCount = Math.max(0, sub.voteCount - 1);
    sub.voters = sub.voters.filter((v) => v !== clientId);
    const receiver = event.participants[sub.clientId];
    if (receiver) receiver.xp = Math.max(0, receiver.xp - 30);
  }
  markDirty();
}

function applyNodeResults(event, idx, broadcasters) {
  const subs = event.submissions.filter((s) => s.nodeIdx === idx).sort((a, b) => b.voteCount - a.voteCount);
  subs.forEach((s, rank) => {
    s.finalRank = rank + 1;
    const p = event.participants[s.clientId];
    if (!p) return;
    if (rank === 0 && s.voteCount > 0) {
      p.xp += 50;
      addBadgeOnce(p, 'top-of-node', '🏆', '节点冠军', broadcasters);
    } else if (rank === 1 && s.voteCount > 0) p.xp += 30;
    else if (rank === 2 && s.voteCount > 0) p.xp += 15;
  });

  const submittedIds = new Set(subs.map((s) => s.clientId));
  for (const p of Object.values(event.participants)) {
    if (submittedIds.has(p.clientId)) {
      p.streak = (p.streak ?? 0) + 1;
      if (p.streak === 3) addBadgeOnce(p, 'puppy', '🐕', '小猎犬', broadcasters);
      if (p.streak === 7) addBadgeOnce(p, 'climber', '🏔️', '稳步攀登者', broadcasters);
      if (p.streak === 12) addBadgeOnce(p, 'flow-master', '🧘', '心流大师', broadcasters);
      if (p.streak === 20) addBadgeOnce(p, 'perfect', '🌟', '全勤先锋', broadcasters);
    } else {
      p.streak = Math.max(0, (p.streak ?? 0) - 1);
    }
  }
}

function applyFinaleAwards(event, broadcasters) {
  const lb = getLeaderboard(event);
  if (lb[0]) addBadgeOnce(event.participants[lb[0].clientId], 'gold', '🥇', 'AI 应用先锋', broadcasters);
  if (lb[1]) addBadgeOnce(event.participants[lb[1].clientId], 'silver', '🥈', '亚军徽', broadcasters);
  if (lb[2]) addBadgeOnce(event.participants[lb[2].clientId], 'bronze', '🥉', '季军徽', broadcasters);
}

function handleHostTransition(event, transition, broadcasters) {
  const idx = event.activeNodeIdx;
  const node = idx >= 0 ? event.nodes[idx] : null;

  switch (transition) {
    case 'start':
      if (event.status === 'lobby') {
        event.status = 'running';
        event.activeNodeIdx = 0;
        event.nodes[0].fsmState = 'reveal';
      }
      break;
    case 'next': {
      // Contextual: based on FSM state, do the "next thing"
      if (!node) break;
      switch (node.fsmState) {
        case 'locked':
          node.fsmState = 'reveal';
          break;
        case 'reveal':
          node.fsmState = 'open';
          node.openedAt = Date.now();
          event.countdownEnd = Date.now() + node.durationSec * 1000;
          event.pausedRemaining = null;
          break;
        case 'open':
          node.fsmState = 'voting';
          node.closedAt = Date.now();
          event.countdownEnd = Date.now() + 60 * 1000;
          event.pausedRemaining = null;
          break;
        case 'voting':
          node.fsmState = 'result';
          event.countdownEnd = null;
          event.pausedRemaining = null;
          applyNodeResults(event, idx, broadcasters);
          break;
        case 'result':
          node.fsmState = 'done';
          if (idx + 1 < event.nodes.length) {
            event.activeNodeIdx = idx + 1;
            event.nodes[idx + 1].fsmState = 'reveal';
          } else {
            event.status = 'finale';
            applyFinaleAwards(event, broadcasters);
          }
          break;
      }
      break;
    }
    case 'back': {
      // One-step undo (limited)
      if (!node) break;
      const back = { reveal: 'locked', open: 'reveal', voting: 'open', result: 'voting' };
      if (back[node.fsmState]) {
        node.fsmState = back[node.fsmState];
        event.countdownEnd = null;
      }
      break;
    }
    case 'pause':
      if (event.countdownEnd) {
        event.pausedRemaining = Math.max(0, event.countdownEnd - Date.now());
        event.countdownEnd = null;
      }
      break;
    case 'resume':
      if (event.pausedRemaining != null) {
        event.countdownEnd = Date.now() + event.pausedRemaining;
        event.pausedRemaining = null;
      }
      break;
    case 'finish':
      event.status = 'finished';
      event.countdownEnd = null;
      break;
    case 'reset':
      event.status = 'lobby';
      event.activeNodeIdx = -1;
      event.countdownEnd = null;
      event.pausedRemaining = null;
      event.nodes.forEach((n) => { n.fsmState = 'locked'; n.openedAt = null; n.closedAt = null; });
      event.submissions = [];
      event.votes = {};
      for (const p of Object.values(event.participants)) {
        p.xp = 0;
        p.streak = 0;
        p.badges = [];
        p.firstCount = 0;
      }
      break;
  }
  markDirty();
}

function handleHostExtend(event, seconds) {
  if (event.countdownEnd) event.countdownEnd += seconds * 1000;
  else if (event.pausedRemaining != null) event.pausedRemaining += seconds * 1000;
  markDirty();
}

// Auto-advance timer
setInterval(() => {
  for (const event of Object.values(db.events)) {
    if (!event.countdownEnd || Date.now() < event.countdownEnd) continue;
    if (event.activeNodeIdx < 0) continue;
    const node = event.nodes[event.activeNodeIdx];
    if (!node) continue;
    const broadcasters = makeBroadcasters(event.code);
    if (node.fsmState === 'open') {
      node.fsmState = 'voting';
      node.closedAt = Date.now();
      event.countdownEnd = Date.now() + 60 * 1000;
      markDirty();
      broadcasters.forEach((b) => b({ type: 'event:state', state: publicEvent(event, null) }));
    } else if (node.fsmState === 'voting') {
      node.fsmState = 'result';
      event.countdownEnd = null;
      applyNodeResults(event, event.activeNodeIdx, broadcasters);
      markDirty();
      broadcasters.forEach((b) => b({ type: 'event:state', state: publicEvent(event, null) }));
    }
  }
}, 500);

// =============================================================================
//  WebSocket layer
// =============================================================================

/** @type {Map<string, Set<WebSocket>>} eventCode -> set of clients in that room */
const rooms = new Map();

function makeBroadcasters(eventCode) {
  // Returns array of fns that send to each connection in the room
  const set = rooms.get(eventCode);
  if (!set) return [];
  return [...set].map((ws) => (msg) => {
    if (ws.readyState === 1) {
      // Personalize state messages with viewer's identity
      let payload = msg;
      if (msg.type === 'event:state' || msg.type === 'event:full') {
        const ev = db.events[eventCode];
        if (ev) payload = { ...msg, state: publicEvent(ev, ws.clientId) };
      }
      ws.send(JSON.stringify(payload));
    }
  });
}

function broadcastFullState(eventCode) {
  const ev = db.events[eventCode];
  if (!ev) return;
  const set = rooms.get(eventCode);
  if (!set) return;
  for (const ws of set) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'event:state', state: publicEvent(ev, ws.clientId) }));
    }
  }
}

function joinRoom(ws, eventCode) {
  if (ws.roomCode === eventCode) return;
  if (ws.roomCode) {
    const old = rooms.get(ws.roomCode);
    if (old) { old.delete(ws); if (old.size === 0) rooms.delete(ws.roomCode); }
  }
  if (!rooms.has(eventCode)) rooms.set(eventCode, new Set());
  rooms.get(eventCode).add(ws);
  ws.roomCode = eventCode;
}

function leaveRoom(ws) {
  if (!ws.roomCode) return;
  const set = rooms.get(ws.roomCode);
  if (set) { set.delete(ws); if (set.size === 0) rooms.delete(ws.roomCode); }

  // Mark participant offline
  const ev = db.events[ws.roomCode];
  if (ev && ws.clientId && ev.participants[ws.clientId]) {
    ev.participants[ws.clientId].online = false;
    broadcastFullState(ws.roomCode);
  }
  ws.roomCode = null;
}

// =============================================================================
//  HTTP / SPA serving
// =============================================================================

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.webp': 'image/webp',
};

// Vendor: serve specific files from node_modules so we don't ship the whole tree
const VENDOR_MAP = {
  'preact.mjs':              'node_modules/preact/dist/preact.mjs',
  'preact-hooks.mjs':        'node_modules/preact/hooks/dist/hooks.mjs',
  'preact-signals.mjs':      'node_modules/@preact/signals/dist/signals.mjs',
  'preact-signals-core.mjs': 'node_modules/@preact/signals-core/dist/signals-core.mjs',
  'htm.mjs':                 'node_modules/htm/dist/htm.mjs',
  'htm-preact.mjs':          'node_modules/htm/preact/index.mjs',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];

  // Vendor (matched first; small set of allowlisted files from node_modules)
  if (url.startsWith('/vendor/')) {
    const key = url.slice('/vendor/'.length);
    const target = VENDOR_MAP[key];
    if (target) {
      serveFile(res, path.join(__dirname, target));
      return;
    }
    res.writeHead(404); res.end('vendor not found'); return;
  }

  // API endpoints (matched before SPA fallback)
  if (url === '/api/curriculum') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(curriculum));
    return;
  }
  if (url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, events: Object.keys(db.events).length, time: Date.now() }));
    return;
  }

  // SPA routes — paths without extensions fall through to index.html
  const isExactSpa = url === '/' || url === '/host';
  const isSpaPrefix = url.startsWith('/e/');
  const hasExt = path.extname(url) !== '';
  if ((isExactSpa || isSpaPrefix) && !hasExt) {
    serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }

  // Static files
  const filePath = path.join(PUBLIC_DIR, url);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  serveFile(res, filePath);
});

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  });
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  ws.clientId = null;
  ws.roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'hello': {
        // Client introduces itself with its persistent client_id
        ws.clientId = String(msg.clientId || randomUUID());
        if (!db.clients[ws.clientId]) db.clients[ws.clientId] = { id: ws.clientId, hostingEvents: [] };
        const meta = db.clients[ws.clientId];
        ws.send(JSON.stringify({
          type: 'hello:ack',
          clientId: ws.clientId,
          lastName: meta.lastName,
          lastAvatar: meta.lastAvatar,
          hostingEvents: meta.hostingEvents ?? [],
        }));
        break;
      }

      case 'create_event': {
        if (!ws.clientId) return;
        const ev = createEvent(ws.clientId, msg.name);
        joinRoom(ws, ev.code);
        ws.send(JSON.stringify({ type: 'event:created', code: ev.code }));
        ws.send(JSON.stringify({ type: 'event:state', state: publicEvent(ev, ws.clientId) }));
        break;
      }

      case 'join_event': {
        if (!ws.clientId) return;
        const ev = db.events[msg.code];
        if (!ev) {
          ws.send(JSON.stringify({ type: 'error', message: '事件码无效' }));
          return;
        }
        joinRoom(ws, ev.code);

        // If non-host and we have a name, register as participant
        if (ws.clientId !== ev.hostClientId && msg.name) {
          joinEvent(ev, ws.clientId, msg.name, msg.avatar);
        } else if (ws.clientId === ev.hostClientId) {
          // Host doesn't auto-join as participant
        }

        ws.send(JSON.stringify({ type: 'event:state', state: publicEvent(ev, ws.clientId) }));
        broadcastFullState(ev.code);
        break;
      }

      case 'set_identity': {
        // Allow user to set/update name+avatar without changing room
        if (!ws.clientId || !ws.roomCode) return;
        const ev = db.events[ws.roomCode];
        if (!ev) return;
        if (ws.clientId === ev.hostClientId) return; // host doesn't become participant
        joinEvent(ev, ws.clientId, msg.name, msg.avatar);
        broadcastFullState(ev.code);
        break;
      }

      case 'submit': {
        if (!ws.clientId || !ws.roomCode) return;
        const ev = db.events[ws.roomCode];
        if (!ev || ws.clientId === ev.hostClientId) return;
        const bcasts = makeBroadcasters(ev.code);
        handleSubmit(ev, ws.clientId, msg.content, bcasts);
        broadcastFullState(ev.code);
        break;
      }

      case 'vote': {
        if (!ws.clientId || !ws.roomCode) return;
        const ev = db.events[ws.roomCode];
        if (!ev || ws.clientId === ev.hostClientId) return;
        const bcasts = makeBroadcasters(ev.code);
        handleVote(ev, ws.clientId, msg.submissionId, bcasts);
        broadcastFullState(ev.code);
        break;
      }

      case 'unvote': {
        if (!ws.clientId || !ws.roomCode) return;
        const ev = db.events[ws.roomCode];
        if (!ev || ws.clientId === ev.hostClientId) return;
        handleUnvote(ev, ws.clientId, msg.submissionId);
        broadcastFullState(ev.code);
        break;
      }

      case 'host:transition': {
        if (!ws.clientId || !ws.roomCode) return;
        const ev = db.events[ws.roomCode];
        if (!ev || ws.clientId !== ev.hostClientId) return;
        const bcasts = makeBroadcasters(ev.code);
        handleHostTransition(ev, msg.transition, bcasts);
        broadcastFullState(ev.code);
        break;
      }

      case 'host:extend': {
        if (!ws.clientId || !ws.roomCode) return;
        const ev = db.events[ws.roomCode];
        if (!ev || ws.clientId !== ev.hostClientId) return;
        handleHostExtend(ev, msg.seconds ?? 60);
        broadcastFullState(ev.code);
        break;
      }

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
        break;
    }
  });

  ws.on('close', () => { leaveRoom(ws); });
});

// =============================================================================
//  Boot
// =============================================================================

loadDb();

server.listen(PORT, () => {
  const lines = [
    '',
    '  ⚡ LightningClass v2',
    '',
    `  Open in browser:  http://localhost:${PORT}`,
    '',
    '  · 任何人都可以创建培训（无需主持人令牌）',
    '  · 创建者自动成为主持人',
    '  · 每场培训有唯一的 6 位 code，扫码或转发链接邀请学员',
    '',
  ];
  console.log(lines.join('\n'));
});
