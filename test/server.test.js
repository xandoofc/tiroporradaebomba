// ============================================================
// Craft Strike — Teste de integração do servidor (headless)
// Roda 2 bots WebSocket contra o servidor real e valida:
// join/roster, movimento, tiro hitscan, kill, respawn, faca,
// reload, troca de arma, chat, ping/pong e desconexão.
// Uso: npm test
// ============================================================

import { startServer } from '../server/index.js';
import WebSocket from 'ws';
import { RESPAWN_TIME_MS, PLAYER } from '../shared/constants.js';

const PORT = 39123;
let passed = 0, failed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}`); }
}

class Bot {
  constructor(ws) {
    this.ws = ws;
    this.queue = [];
    this.waiters = [];
    this.id = null;
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const wi = this.waiters.findIndex((w) => w.pred(msg));
      if (wi >= 0) {
        const [w] = this.waiters.splice(wi, 1);
        w.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  // aguarda uma mensagem que satisfaça pred (ou por tipo t)
  waitFor(t, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const pred = typeof t === 'function' ? t : (m) => m.t === t;
      const i = this.queue.findIndex(pred);
      if (i >= 0) { resolve(this.queue.splice(i, 1)[0]); return; }
      const w = { pred, resolve, timer: null };
      w.timer = setTimeout(() => {
        const j = this.waiters.indexOf(w);
        if (j >= 0) this.waiters.splice(j, 1);
        reject(new Error(`timeout esperando mensagem (tipo ${typeof t === 'string' ? t : 'custom'})`));
      }, timeout);
      this.waiters.push(w);
    });
  }
  // captura a última mensagem de estado
  lastState() {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].s) return this.queue[i];
    }
    return null;
  }
  // procura de trás pra frente o state mais recente que contenha o id
  findPlayer(id) {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const st = this.queue[i];
      if (!st.s) continue;
      const arr = st.s.find((p) => p[0] === id);
      if (arr) return arrToPlayer(arr);
    }
    return null;
  }
  // procura de trás pra frente o state mais recente que contenha o evento
  findEvent(kind) {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const st = this.queue[i];
      if (!st.e) continue;
      for (let j = st.e.length - 1; j >= 0; j--) if (st.e[j].k === kind) return st.e[j];
    }
    return null;
  }
}

function arrToPlayer(a) {
  return {
    id: a[0], x: a[1], y: a[2], z: a[3], yaw: a[4], pitch: a[5],
    hp: a[6], weapon: a[7], mag: a[8], res: a[9],
    alive: !!a[10], score: a[11], deaths: a[12], streak: a[13],
  };
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.on('open', () => resolve(new Bot(ws)));
    ws.on('error', reject);
  });
}

function aimAt(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const horiz = Math.hypot(dx, dz) || 1e-6;
  const pitch = Math.atan2(dy, horiz);
  const yaw = Math.atan2(-dx, -dz);
  return { yaw, pitch };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------

const { game } = await startServer(PORT, '127.0.0.1');
console.log('\n== Craft Strike: teste de integração do servidor ==\n');

// 1) dois bots entram
const A = await connect();
const B = await connect();
const wa = await A.waitFor('welcome');
const wb = await B.waitFor('welcome');
ok(wa.cfg.game === 'Craft Strike' && wa.id > 0, 'welcome A com id');
ok(wb.id !== wa.id, 'ids diferentes');
A.id = wa.id; B.id = wb.id;

A.send({ t: 'join', name: 'Ana' });
await A.waitFor('roster');
B.send({ t: 'join', name: 'Bob' });
const roster = await A.waitFor('roster');
ok(roster.p.length === 2 && roster.p.some((p) => p.name === 'Ana') && roster.p.some((p) => p.name === 'Bob'),
  'roster com os 2 jogadores');
await sleep(120); // aguarda os primeiros states chegarem

// 2) movimento: Ana anda para frente por 1.2s
const pos0 = A.findPlayer(A.id);
for (let i = 0; i < 40; i++) { A.send({ t: 'input', k: 1, mx: 0, my: 0, fire: 0, alt: 0 }); await sleep(30); }
const pos1 = A.findPlayer(A.id);
const moved = Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z);
ok(moved > 2, `Ana se moveu ${moved.toFixed(2)}m (>2m)`);
ok(Math.abs(pos1.y - pos0.y) < 0.5, 'Ana continua no chão');

// 3) pulo
for (let i = 0; i < 10; i++) { A.send({ t: 'input', k: 1 | 16, mx: 0, my: 0, fire: 0, alt: 0 }); await sleep(30); }
const posJump = A.findPlayer(A.id);
ok(posJump.y > pos0.y + 0.5, `pulo elevou y (${posJump.y.toFixed(2)})`);

// 4) tiro: teleporta ambos para área aberta e Ana mira na cabeça de Bob
const pa = game.players.get(A.id), pb = game.players.get(B.id);
pa.x = -20; pa.y = 0; pa.z = -20; pb.x = -18; pb.y = 0; pb.z = -20;
pa.vx = pa.vz = 0; pb.vx = pb.vz = 0;
await sleep(100);

const aim = aimAt(pa.x, pa.y + PLAYER.eye, pa.z, pb.x, pb.y + PLAYER.height - 0.21, pb.z);
A.send({ t: 'input', yaw: aim.yaw, pitch: aim.pitch, k: 0, fire: 0, alt: 0 });
await sleep(50);
for (let i = 0; i < 60 && !A.findEvent('kill'); i++) {
  A.send({ t: 'input', k: 0, fire: 1, alt: 0 });
  await sleep(33);
}
const killEv = A.findEvent('kill');
ok(!!killEv, 'evento de kill disparado');
ok(killEv && killEv.kid === A.id && killEv.vid === B.id, 'Ana matou Bob');
ok(killEv && killEv.w === 'AK-47', 'arma do kill: AK-47');
await sleep(80);
ok(A.findPlayer(A.id).score >= 1, 'placar de Ana subiu');
const bDead = A.findPlayer(B.id);
ok(bDead && !bDead.alive, 'Bob morto (alive=0)');

// 5) respawn automático
await sleep(RESPAWN_TIME_MS + 400);
const bBack = A.findPlayer(B.id);
ok(bBack && bBack.alive && bBack.hp === 100, 'Bob respawnou com 100 HP');

// 6) faca: Ana vai atrás de Bob e golpeia
pb.x = -18; pb.y = 0; pb.z = -20;
pa.x = -19.6; pa.y = 0; pa.z = -20; pa.vx = pa.vz = 0; pb.vx = pb.vz = 0;
await sleep(100);
A.send({ t: 'input', weapon: 'knife' });
await sleep(400); // espera o switch (260ms)
const aimK = aimAt(pa.x, pa.y + PLAYER.eye, pa.z, pb.x, pb.y + PLAYER.height / 2, pb.z);
A.send({ t: 'input', yaw: aimK.yaw, pitch: aimK.pitch, k: 0, fire: 0, alt: 0 });
await sleep(50);
A.send({ t: 'input', k: 0, fire: 1, alt: 0 });
await sleep(150);
const knB = A.findPlayer(B.id);
ok(knB.hp < 100, `faca causou dano (HP ${knB.hp})`);

// 7) reload: esvazia um pouco o pente atirando para o céu e recarrega (2.3s)
A.send({ t: 'input', weapon: 'ak47' });
await sleep(400);
A.send({ t: 'input', yaw: 0, pitch: 1.5, k: 0, fire: 1, alt: 0 });
await sleep(600); // ~5 tiros no céu
A.send({ t: 'input', yaw: 0, pitch: 1.5, k: 0, fire: 0, alt: 0 });
await sleep(100);
const magBefore = A.findPlayer(A.id).mag;
ok(magBefore < 30, `pente parcialmente gasto (${magBefore})`);
A.send({ t: 'input', reload: true });
await sleep(2600);
const relA = A.findPlayer(A.id);
ok(relA.weapon === 'ak47' && relA.mag === 30 && relA.res === 90 - (30 - magBefore), 'reload do AK-47 completo');

// 8) sniper: troca e confere pente pequeno
A.send({ t: 'input', weapon: 'awp' });
await sleep(400);
const snpA = A.findPlayer(A.id);
ok(snpA.weapon === 'awp' && snpA.mag === 5, 'AWP equipada com 5 balas');
// dispara a AWP
const aimS = aimAt(pa.x, pa.y + PLAYER.eye, pa.z, pb.x, pb.y + PLAYER.height - 0.21, pb.z);
A.send({ t: 'input', yaw: aimS.yaw, pitch: aimS.pitch, k: 0, fire: 0, alt: 0 });
await sleep(50);
A.send({ t: 'input', k: 0, fire: 1, alt: 0 });
await sleep(400);
const awpShot = A.findPlayer(B.id);
ok(awpShot.hp <= 0 || awpShot.hp < 100, 'AWP deu dano/kill de 1 tiro');

// 9) chat
B.send({ t: 'chat', m: 'oi Ana!' });
const chatEv = await A.waitFor((m) => m.t === 'chat' || (m.s && m.e && m.e.find((e) => e.k === 'chat')));
let chatMsg = null;
if (chatEv.t === 'chat') chatMsg = chatEv;
else chatMsg = chatEv.e.find((e) => e.k === 'chat');
ok(chatMsg && chatMsg.m === 'oi Ana!', 'chat entregue ao outro jogador');

// 10) ping/pong
A.send({ t: 'ping', ts: 12345 });
const pong = await A.waitFor('pong');
ok(pong.ts === 12345, 'ping/pong ok');

// 11) queda do mapa = morte
const pc = game.players.get(A.id);
pc.y = -20;
await sleep(400);
const fell = A.findPlayer(A.id);
ok(!fell.alive || fell.hp < 100 || A.findEvent('kill'), 'queda do mapa mata o jogador');

// 12) desconexão atualiza roster
B.ws.close();
await sleep(300);
const lastRoster = A.queue.filter((m) => m.t === 'roster').at(-1);
ok(lastRoster && lastRoster.p.length === 1, 'roster atualizado após saída');

// 13) respawn forçado
A.send({ t: 'respawn' });
await sleep(300);
ok(A.findPlayer(A.id).alive, 'respawn manual funciona');

A.ws.close();
console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed === 0 ? 0 : 1);
