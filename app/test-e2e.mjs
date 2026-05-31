// E2E: create event, 3 learners join, advance through Node 1.
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

const PORT = process.env.PORT || 3000;

function connect() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.messages = [];
    ws.received = {};
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      ws.messages.push(m);
      ws.received[m.type] = m;
    });
    ws.once('open', () => resolve(ws));
  });
}

const send = (ws, msg) => ws.send(JSON.stringify(msg));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(ws, type, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (ws.received[type]) return ws.received[type];
    await sleep(30);
  }
  throw new Error(`Timeout waiting for ${type}`);
}

async function main() {
  console.log('1) Connect 4 sockets…');
  const host = await connect();
  const a = await connect();
  const b = await connect();
  const c = await connect();

  // Identities
  const hostId = randomUUID();
  const aId = randomUUID();
  const bId = randomUUID();
  const cId = randomUUID();

  send(host, { type: 'hello', clientId: hostId });
  send(a,    { type: 'hello', clientId: aId });
  send(b,    { type: 'hello', clientId: bId });
  send(c,    { type: 'hello', clientId: cId });
  await sleep(150);

  console.log('2) Host creates event…');
  send(host, { type: 'create_event', name: 'Smoke Test Event' });
  const created = await waitFor(host, 'event:created');
  const code = created.code;
  console.log(`   → code = ${code}`);

  console.log('3) Three learners join via code…');
  send(a, { type: 'join_event', code, name: '小A', avatar: '🦊' });
  send(b, { type: 'join_event', code, name: '小B', avatar: '🐼' });
  send(c, { type: 'join_event', code, name: '小C', avatar: '🦁' });
  await sleep(300);

  console.log('4) Host starts event…');
  send(host, { type: 'host:transition', transition: 'start' });
  await sleep(150);

  console.log('5) Host: locked → reveal → open (two "next" clicks)…');
  send(host, { type: 'host:transition', transition: 'next' }); // reveal → open
  await sleep(150);

  // Three submissions
  console.log('6) Three learners submit…');
  send(a, { type: 'submit', content: '我是小A，第一个交！' });
  await sleep(50);
  send(b, { type: 'submit', content: '小B认真版答案，希望被认可！' });
  await sleep(50);
  send(c, { type: 'submit', content: '小C晚到的反思版本。' });
  await sleep(300);

  // Verify first-submitter logic
  let state = a.received['event:state'].state;
  const subA = state.submissions.find(s => s.content.includes('小A'));
  const subB = state.submissions.find(s => s.content.includes('小B'));
  if (!subA.isFirst) throw new Error('小A should be marked first');
  console.log(`   ✓ 小A.isFirst = ${subA.isFirst}`);

  console.log('7) Close + start voting…');
  send(host, { type: 'host:transition', transition: 'next' }); // open → voting
  await sleep(200);

  console.log('8) Cross-votes…');
  send(a, { type: 'vote', submissionId: subB.id });
  send(b, { type: 'vote', submissionId: subA.id });
  send(c, { type: 'vote', submissionId: subA.id });
  send(c, { type: 'vote', submissionId: subB.id });
  await sleep(300);

  console.log('9) Reveal results…');
  send(host, { type: 'host:transition', transition: 'next' }); // voting → result
  await sleep(300);

  // Check leaderboard
  state = a.received['event:state'].state;
  console.log('   Leaderboard:');
  for (const p of state.leaderboard) {
    console.log(`     #${p.rank} ${p.avatar} ${p.name} — ${p.xp} XP — badges: ${p.badges.map(b => b.emoji).join('')}`);
  }

  console.log('10) Test unvote (B unvotes A)…');
  send(b, { type: 'unvote', submissionId: subA.id });
  await sleep(150);

  console.log('11) Advance to Node 2…');
  send(host, { type: 'host:transition', transition: 'next' }); // result → next node
  await sleep(200);

  state = a.received['event:state'].state;
  console.log(`   activeNodeIdx = ${state.activeNodeIdx}, Node 2 state = ${state.nodes[1].fsmState}`);
  if (state.activeNodeIdx !== 1) throw new Error('Expected Node 2 to be active');
  if (state.nodes[0].fsmState !== 'done') throw new Error('Node 1 should be done');

  console.log('12) Test pause/resume on Node 2…');
  send(host, { type: 'host:transition', transition: 'next' }); // reveal → open (start countdown)
  await sleep(150);
  send(host, { type: 'host:transition', transition: 'pause' });
  await sleep(150);
  state = host.received['event:state'].state;
  if (state.countdownEnd !== null || state.pausedRemaining == null) throw new Error('Pause did not record remaining');
  console.log(`   ✓ paused with ${Math.round(state.pausedRemaining / 1000)}s remaining`);
  send(host, { type: 'host:transition', transition: 'resume' });
  await sleep(150);
  state = host.received['event:state'].state;
  if (state.countdownEnd == null) throw new Error('Resume did not restart countdown');
  console.log('   ✓ resumed');

  console.log('\n✓ All E2E checks passed.');
  host.close(); a.close(); b.close(); c.close();
  await sleep(100);
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
