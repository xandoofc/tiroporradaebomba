// ============================================================
// Craft Strike — Stress test
// 25 bots conectam, andam e atiram simultaneamente.
// Valida: nenhum crash, states fluindo, kills acontecendo,
// uso de memória estável.
// ============================================================

import { startServer } from '../server/index.js';
import WebSocket from 'ws';

const PORT = 39141;
const BOTS = 25;
const { game } = await startServer(PORT, '127.0.0.1');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✔', l); } else { failed++; console.error('  ✘', l); } };

const bots = [];
for (let i = 0; i < BOTS; i++) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const bot = { ws, states: 0, kills: 0, id: null, name: 'Bot' + i };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'welcome') { bot.id = m.id; ws.send(JSON.stringify({ t: 'join', name: bot.name })); }
    else if (m.s) {
      bot.states++;
      for (const e of m.e) if (e.k === 'kill' && e.kid === bot.id) bot.kills++;
    }
  });
  bots.push(bot);
}

console.log(`\n== Craft Strike: stress test (${BOTS} bots) ==\n`);

// aguarda todos conectarem e darem join
await new Promise((r) => setTimeout(r, 2000));
const joined = bots.filter((b) => b.id !== null).length;
ok(joined === BOTS, `todos os ${joined} bots entraram`);

// 8 segundos de ação: todos andam em direções aleatórias e atiram
const t0 = Date.now();
let frame = 0;
while (Date.now() - t0 < 8000) {
  for (const b of bots) {
    if (b.ws.readyState !== 1) continue;
    const k = 1 + (Math.floor(Math.random() * 3) * 2); // frente ou lado
    b.ws.send(JSON.stringify({
      t: 'input', yaw: (frame + b.id) * 0.05, pitch: 0, k,
      fire: Math.random() < 0.5 ? 1 : 0, alt: 0, weapon: ['ak47', 'awp', 'deagle'][b.id % 3],
    }));
  }
  frame++;
  await new Promise((r) => setTimeout(r, 100));
}
const elapsed = (Date.now() - t0) / 1000;

// estados fluindo para todo mundo
const minStates = Math.min(...bots.map((b) => b.states));
ok(minStates > 200, `todos recebem states (mínimo ${minStates} em ${elapsed.toFixed(0)}s)`);

// kills acontecendo
const totalKills = bots.reduce((s, b) => s + b.kills, 0);
ok(totalKills > 10, `${totalKills} kills registradas`);

// ninguém caiu / conexões vivas
const alive = bots.filter((b) => b.ws.readyState === 1).length;
ok(alive === BOTS, `todas as ${alive} conexões vivas`);

// memória estável (sem vazamento óbvio)
const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
ok(heapMB < 300, `heap estável (${heapMB}MB)`);

// todos os jogadores na simulação
ok(game.players.size === BOTS, `simulação com ${game.players.size} jogadores`);

for (const b of bots) b.ws.close();
console.log(`\nResultado: ${passed} passaram, ${failed} falharam (${heapMB}MB heap)`);
process.exit(failed === 0 ? 0 : 1);
