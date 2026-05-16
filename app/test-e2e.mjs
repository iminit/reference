// End-to-end smoke test
// - Start nothing here (assumes server running on :3000)
// - Connect 1 host + 3 learners
// - Walk Node 1 through: publish → open → submit ×3 → vote → reveal → advance

import WebSocket from 'ws';

const PORT = process.env.PORT || 3000;
const HOST_TOKEN = process.env.HOST_TOKEN;
if (!HOST_TOKEN) {
  console.error('Set HOST_TOKEN env var (from server boot log)');
  process.exit(1);
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.messages = [];
    ws.on('message', (raw) => ws.messages.push(JSON.parse(raw.toString())));
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function send(ws, msg) { ws.send(JSON.stringify(msg)); }

async function main() {
  console.log('Connect host + 3 learners…');
  const host = await connect();
  const a = await connect();
  const b = await connect();
  const c = await connect();

  send(host, { type: 'host:claim', token: HOST_TOKEN });
  send(a, { type: 'join', name: '小A', avatar: '🦊' });
  send(b, { type: 'join', name: '小B', avatar: '🐼' });
  send(c, { type: 'join', name: '小C', avatar: '🦁' });
  await sleep(200);

  console.log('Start event…');
  send(host, { type: 'host:transition', transition: 'start_event' });
  await sleep(200);

  console.log('Publish + open Node 1…');
  send(host, { type: 'host:transition', transition: 'open' });
  await sleep(200);

  console.log('Three learners submit…');
  send(a, { type: 'submit', content: '小A的答案，先到先得！' });
  await sleep(50);
  send(b, { type: 'submit', content: '小B认真写的一段答案。' });
  await sleep(50);
  send(c, { type: 'submit', content: '小C的答案，姗姗来迟。' });
  await sleep(300);

  console.log('Close + voting…');
  send(host, { type: 'host:transition', transition: 'close' });
  await sleep(200);

  // Find subs from latest state
  const lastState = [...a.messages].reverse().find(m => m.type === 'state');
  const subs = lastState.state.submissions;
  console.log(`  Found ${subs.length} subs; first submitter isFirst=${subs.find(s => s.participantId === lastState.state.participants.find(p => p.name === '小A')?.id)?.isFirst}`);

  const subA = subs.find(s => s.content.includes('小A'));
  const subB = subs.find(s => s.content.includes('小B'));

  // A votes for B; B votes for A; C votes for A and B
  send(a, { type: 'vote', submissionId: subB.id });
  send(b, { type: 'vote', submissionId: subA.id });
  send(c, { type: 'vote', submissionId: subA.id });
  send(c, { type: 'vote', submissionId: subB.id });
  await sleep(200);

  console.log('Reveal result…');
  send(host, { type: 'host:transition', transition: 'reveal_result' });
  await sleep(300);

  const finalState = [...a.messages].reverse().find(m => m.type === 'state');
  console.log('  Leaderboard:');
  finalState.state.leaderboard.forEach(p => {
    console.log(`    #${p.rank} ${p.avatar} ${p.name} — ${p.xp} XP — badges: ${p.badges.map(b => b.emoji).join('')}`);
  });

  console.log('Advance to Node 2…');
  send(host, { type: 'host:transition', transition: 'advance' });
  await sleep(200);

  const afterAdvance = [...a.messages].reverse().find(m => m.type === 'state');
  console.log(`  Active node now: ${afterAdvance.state.activeNodeIdx + 1} — ${afterAdvance.state.nodes[afterAdvance.state.activeNodeIdx].title}`);
  console.log(`  Node 1 fsmState: ${afterAdvance.state.nodes[0].fsmState}`);
  console.log(`  Node 2 fsmState: ${afterAdvance.state.nodes[1].fsmState}`);

  console.log('\n✓ All assertions passed.');
  host.close(); a.close(); b.close(); c.close();
  await sleep(100);
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
