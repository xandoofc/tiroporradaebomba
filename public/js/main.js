// ============================================================
// Craft Strike — Cliente principal
// Conexão, predição de movimento (física compartilhada),
// reconciliação com o servidor, render loop e HUD.
// ============================================================

import { Net } from './net.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { GameView } from './render.js';
import { Hud, esc } from './hud.js';
import { movePlayer, rayMap } from '../../shared/physics.js';
import { MAP_BOXES } from '../../shared/map.js';
import { WEAPONS, baseSpeed } from '../../shared/weapons.js';
import { PLAYER, SENSITIVITY, PITCH_LIMIT, RESPAWN_TIME_MS, COLORS } from '../../shared/constants.js';

const TICK = 1000 / 30;

const state = {
  id: null, cfg: null, net: null, input: null, view: null, hud: null, audio: null,
  menuOpen: true, chatOpen: false,
  roster: new Map(),          // id -> {name, color}
  pings: new Map(),           // id -> ms
  snapshots: [],              // {arrival, players: Map}
  lastKill: null,             // último evento kill (para tela de morte)
  firedAt: 0,                 // cooldown visual local
  stepTimer: 0,
  lastPingAt: 0, rtt: 0,
  fpsFrames: 0, fpsTime: 0, fps: 0,
  reconnectTimer: null,
  name: '', color: '#7bdc4a',
};

// ---- jogador local (predição) ----
const self = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0, onGround: false, onGroundPrev: true,
  hp: 100, alive: true, weapon: 'ak47', mag: 0, res: 0,
  score: 0, deaths: 0, streak: 0,
  moving: 0, walkPhase: 0, reloadingUntil: 0,
};

const canvas = document.getElementById('game-canvas');
const input = new Input(canvas);
const hud = new Hud();
const audio = new AudioSys();
let net = null;
let view = null;

// ============================================================
// MENU
// ============================================================

const colorPicker = document.getElementById('color-picker');
for (const c of COLORS) {
  const s = document.createElement('div');
  s.className = 'swatch';
  s.style.background = c;
  s.dataset.color = c;
  if (c === state.color) s.classList.add('sel');
  s.addEventListener('click', () => {
    state.color = c;
    for (const o of colorPicker.children) o.classList.toggle('sel', o === s);
  });
  colorPicker.appendChild(s);
}

const statusEl = document.getElementById('server-status');
const joinBtn = document.getElementById('join-btn');

async function join() {
  const name = (document.getElementById('nickname').value || '').trim() || 'Jogador';
  state.name = name.slice(0, 16);
  joinBtn.disabled = true;
  statusEl.textContent = 'conectando ao servidor…';
  statusEl.className = 'server-status';
  audio.init();
  audio.resume();

  net = new Net();
  wireNet(net);

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws`;
  try {
    await net.connect(url);
    statusEl.textContent = 'conectado! entrando na partida…';
    statusEl.className = 'server-status ok';
    net.send({ t: 'join', name: state.name });
  } catch {
    statusEl.textContent = 'não foi possível conectar. o servidor está online?';
    statusEl.className = 'server-status err';
    joinBtn.disabled = false;
  }
}

joinBtn.addEventListener('click', join);
document.getElementById('nickname').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

// ============================================================
// REDE
// ============================================================

function wireNet(n) {
  n.on('welcome', (m) => {
    state.id = m.id;
    state.cfg = m.cfg;
    beginGame();
  });

  n.on('roster', (m) => {
    state.roster = new Map(m.p.map((p) => [p.id, p]));
    if (view) {
      for (const id of [...view.remotes.keys()]) if (!state.roster.has(id)) view.removeRemote(id);
      for (const [id, p] of state.roster) {
        if (id === state.id) continue;
        if (!view.remotes.has(id)) view.addRemote(id, p.color, id % 8);
      }
    }
    hud.scoreboardRender([...state.roster.values()].map((p) => ({ ...p, score: selfScore(p.id), deaths: selfDeaths(p.id) })), state.id, state.pings);
  });

  n.on('state', onState);
  n.on('pong', (m) => { state.rtt = Math.max(1, Math.min(999, performance.now() - m.ts)); state.pings.set(state.id, state.rtt); });

  n.on('ev:shot', (e) => {
    if (e.id === state.id) {
      if (e.h) { hud.hitmarker(); audio.hit(false); }
      return;
    }
    const from = { x: e.f[0], y: e.f[1], z: e.f[2] };
    const to = { x: e.t[0], y: e.t[1], z: e.t[2] };
    view && view.addShot(from, to);
    // fogo no cano do atirador (visível para os outros jogadores)
    if (view && e.w !== 'knife') {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      view.remoteMuzzle(from.x + (dx / len) * 0.7, from.y + (dy / len) * 0.7, from.z + (dz / len) * 0.7);
    }
    // som com atenuação por distância
    const d = Math.hypot(from.x - self.x, from.y - (self.y + PLAYER.eye), from.z - self.z);
    const vol = d > 70 ? 0.12 : d > 35 ? 0.35 : 1;
    audio.shot(e.w, vol);
    if (e.w === 'knife') audio.knifeHit();
  });

  n.on('ev:hurt', (e) => {
    if (e.id !== state.id) return;
    hud.damageFlash();
    audio.hurt();
  });

  n.on('ev:kill', (e) => {
    const k = state.roster.get(e.kid);
    const v = state.roster.get(e.vid);
    hud.killfeedAdd(k?.name || '?', k?.color, e.w, v?.name || '?', !!e.hs);
    if (e.kid === state.id) audio.kill();
    if (e.vid === state.id) {
      state.lastKill = e;
      audio.kill();
    }
  });

  n.on('ev:respawn', (e) => {
    if (e.id === state.id) { hud.deathHide(); audio.respawn(); }
  });

  n.on('ev:reload', (e) => {
    if (e.id !== state.id) return;
    self.reloadingUntil = performance.now() + (WEAPONS[self.weapon]?.reloadMs || 2000);
    audio.reload();
    const w = WEAPONS[self.weapon];
    view && view.setViewAnim('reload', (w ? w.reloadMs : 2000) / 1000);
  });

  n.on('ev:reloadend', (e) => { if (e.id === state.id) { self.reloadingUntil = 0; audio.reloadEnd(); } });
  n.on('ev:dry', (e) => { if (e.id === state.id) audio.dry(); });

  n.on('ev:switch', (e) => {
    if (e.id !== state.id) return;
    self.reloadingUntil = 0;
    audio.switchGun();
    view && view.setViewAnim('switch', 0.26);
  });

  n.on('ev:streak', (e) => {
    if (e.id !== state.id) return;
    const names = { 3: ['TRIPLE KILL', '3 abates seguidos'], 5: ['RAMPAGE', '5 abates seguidos'], 10: ['UNSTOPPABLE', '10 abates seguidos!'] };
    const [t, s] = names[e.n] || [e.n + ' abates', ''];
    hud.bannerShow(t, s);
    audio.streak(e.n);
  });

  n.on('ev:chat', (e) => {
    const p = state.roster.get(e.id);
    hud.chatAdd(p?.name || '?', p?.color, e.m);
    audio.chat();
  });
  n.on('ev:sys', (e) => { hud.chatSys(e.m); audio.chat(); });

  n.on('close', () => {
    hud.connShow();
    state.reconnectTimer = setTimeout(() => location.reload(), 6000);
  });
}

function selfScore(id) { const sn = latestSnapshot(); return sn ? (sn.players.get(id)?.score ?? 0) : 0; }
function selfDeaths(id) { const sn = latestSnapshot(); return sn ? (sn.players.get(id)?.deaths ?? 0) : 0; }

// ============================================================
// INÍCIO DO JOGO
// ============================================================

function beginGame() {
  view = new GameView(canvas);
  hud.showGame();
  state.menuOpen = false;
  hud.connHide();
  hud.chatSys(`bem-vindo(a), ${state.name}!`);
  hud.chatSys('F2 mostra o placar · Enter abre o chat · Esc para pausar');

  input.onScoreboard = (on) => {
    if (on && !state.chatOpen) {
      const rows = [...state.roster.values()].map((p) => {
        const sn = latestSnapshot();
        const arr = sn ? sn.players.get(p.id) : null;
        return { ...p, score: arr ? arr.score : 0, deaths: arr ? arr.deaths : 0 };
      });
      hud.scoreboardRender(rows, state.id, state.pings);
      hud.scoreboardShow();
    } else hud.scoreboardHide();
  };
  input.onChat = toggleChat;
  input.onMute = () => {
    const muted = audio.toggleMute();
    hud.chatSys(muted ? 'som desativado (M)' : 'som ativado (M)');
  };

  canvas.addEventListener('click', () => {
    if (!state.menuOpen && !state.chatOpen) input.requestLock();
  });

  setInterval(sendInput, TICK);
  setInterval(sendPing, 2000);
  renderLoop();
}

function toggleChat() {
  if (!state.chatOpen) {
    state.chatOpen = true;
    hud.chatInput.classList.remove('hidden');
    hud.chatInput.focus();
    document.exitPointerLock && document.exitPointerLock();
  } else {
    sendChat();
  }
}

function sendChat() {
  const text = hud.chatInput.value.trim();
  hud.chatInput.value = '';
  hud.chatInput.classList.add('hidden');
  state.chatOpen = false;
  input.requestLock();
  if (text) net.send({ t: 'chat', m: text });
}

hud.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
  if (e.key === 'Escape') { hud.chatInput.value = ''; sendChat(); }
});
document.getElementById('respawn-now').addEventListener('click', () => {
  net.send({ t: 'respawn' });
  hud.deathHide();
});
document.getElementById('reconnect-btn').addEventListener('click', () => location.reload());

// ============================================================
// ESTADO DO SERVIDOR → SNAPSHOTS + RECONCILIAÇÃO
// ============================================================

function onState(m) {
  const snap = { arrival: performance.now(), players: new Map() };
  for (const arr of m.s) {
    snap.players.set(arr[0], {
      id: arr[0], x: arr[1], y: arr[2], z: arr[3], yaw: arr[4], pitch: arr[5],
      hp: arr[6], weapon: arr[7], mag: arr[8], res: arr[9],
      alive: !!arr[10], score: arr[11], deaths: arr[12], streak: arr[13],
    });
  }
  state.snapshots.push(snap);
  if (state.snapshots.length > 8) state.snapshots.shift();

  const me = snap.players.get(state.id);
  if (!me) return;

  // reconciliação de posição (apenas se divergir muito)
  const dx = me.x - self.x, dy = me.y - self.y, dz = me.z - self.z;
  if (dx * dx + dy * dy + dz * dz > 0.36) {
    self.x = me.x; self.y = me.y; self.z = me.z;
    self.vx = self.vy = self.vz = 0;
  }

  // morte / vida
  if (me.alive && !self.alive) {
    hud.deathHide();
  }
  self.alive = me.alive;
  self.hp = me.hp;
  self.weapon = me.weapon;
  self.mag = me.mag;
  self.res = me.res;
  self.score = me.score;
  self.deaths = me.deaths;
  self.streak = me.streak;
  if (!me.alive) self.reloadingUntil = 0;

  // morte local: mostra tela
  if (!me.alive && state.lastKill && state.lastKill.vid === state.id) {
    const k = state.roster.get(state.lastKill.kid);
    hud.deathShow(k?.name, k?.color, state.lastKill.w, RESPAWN_TIME_MS);
    state.lastKill = null;
  }

  // HUD
  hud.setHealth(self.hp);
  hud.setAmmo(self.mag, self.res, self.weapon, performance.now() < self.reloadingUntil);
  hud.setWeaponSlot(self.weapon);
  hud.setKD(self.score, self.deaths);
  hud.setStreak(self.streak);

  // líder
  let leader = null, best = 0;
  for (const p of snap.players.values()) if (p.score > best) { best = p.score; leader = p; }
  if (leader && leader.id !== state.id) hud.setLeader(state.roster.get(leader.id)?.name || '?', best);
  else if (leader && leader.id === state.id) hud.setLeader('VOCÊ', best);
}

function latestSnapshot() {
  return state.snapshots.length ? state.snapshots[state.snapshots.length - 1] : null;
}

// ============================================================
// ENVIO DE ENTRADA + PREDIÇÃO
// ============================================================

function sendInput() {
  if (!net || !state.id) return;
  const dt = TICK / 1000;

  // mira (deltas do mouse aplicados localmente)
  const kmsg = input.poll();
  self.yaw = self.yaw - kmsg.mx * SENSITIVITY;
  self.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, self.pitch - kmsg.my * SENSITIVITY));

  const w = WEAPONS[self.weapon];
  const maxSpeed = baseSpeed(self.weapon);

  // scoped (AWP com botão direito)
  const wantScoped = self.weapon === 'awp' && kmsg.alt && self.alive;

  // disparo visual local (o servidor decide o dano)
  const now = performance.now();
  const canFire = now - state.firedAt >= (w ? w.fireMs : 100);
  if (kmsg.fire && self.alive && canFire && self.mag > 0 && w.kind !== 'melee') {
    state.firedAt = now;
    view && view.fireVisual(); // só o recuo da arma (sem fogo no FOV)
    audio.shot(self.weapon);
    // tracer do próprio tiro (raycast real: não atravessa parede)
    if (view) {
      const eye = { x: self.x, y: self.y + PLAYER.eye, z: self.z };
      const f = forwardDir();
      const hit = rayMap(eye, f, MAP_BOXES, 60);
      const dist = hit ? hit.t : 60;
      view.addShot(eye, { x: eye.x + f.x * dist, y: eye.y + f.y * dist, z: eye.z + f.z * dist });
    }
  }
  if (kmsg.fire && w && w.kind === 'melee' && self.alive && canFire) {
    state.firedAt = now;
    view && view.setViewAnim('knife', 0.45);
    audio.shot('knife');
  }

  // predição de movimento (física compartilhada)
  if (self.alive) {
    const mv = { mx: (kmsg.k & 4 ? -1 : 0) + (kmsg.k & 8 ? 1 : 0), my: (kmsg.k & 1 ? 1 : 0) + (kmsg.k & 2 ? -1 : 0), jump: (kmsg.k & 16) !== 0 };
    const speedMult = wantScoped ? 0.5 : 1;
    movePlayer(self, mv, MAP_BOXES, maxSpeed * speedMult, dt);
  }

  // animação de caminhada
  self.moving = Math.hypot(self.vx, self.vz);
  if (self.moving > 0.5 && self.onGround) {
    self.walkPhase += self.moving * dt * 2.2;
    state.stepTimer -= dt;
    if (state.stepTimer <= 0) { audio.footstep(); state.stepTimer = 0.36; }
  }

  net.send({
    t: 'input',
    yaw: Math.round(self.yaw * 1000) / 1000,
    pitch: Math.round(self.pitch * 1000) / 1000,
    k: kmsg.k, mx: 0, my: 0,
    fire: kmsg.fire, alt: kmsg.alt ? 1 : 0,
    reload: kmsg.reload ? 1 : 0,
    weapon: kmsg.weapon || undefined,
  });
}

function forwardDir() {
  const cp = Math.cos(self.pitch);
  return { x: -Math.sin(self.yaw) * cp, y: Math.sin(self.pitch), z: -Math.cos(self.yaw) * cp };
}

function sendPing() {
  if (!net) return;
  state.lastPingAt = performance.now();
  net.send({ t: 'ping', ts: state.lastPingAt });
  hud.setPing(state.rtt);
}

// ============================================================
// RENDER LOOP
// ============================================================

let lastFrame = performance.now();

// VSync OFF: loop de render contínuo (sem requestAnimationFrame, que
// sincroniza com o refresh do monitor). O contexto WebGL roda com
// desynchronized:true, então cada frame é apresentado o mais rápido
// possível — menor latência, FPS acima da taxa do monitor.
function renderLoop() {
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  setTimeout(renderLoop, 0);

  // fps
  state.fpsFrames++;
  if (now - state.fpsTime >= 500) {
    state.fps = Math.round(state.fpsFrames * 1000 / (now - state.fpsTime));
    state.fpsFrames = 0; state.fpsTime = now;
    hud.setFps(state.fps);
  }

  if (!view) return;

  const w = WEAPONS[self.weapon];
  view.setSelf({
    x: self.x, y: self.y, z: self.z, yaw: self.yaw, pitch: self.pitch,
    weapon: self.weapon, moving: Math.min(1, self.moving / 2),
    walkPhase: self.walkPhase,
    scoped: self.weapon === 'awp' && self.alive && input.alt,
  });

  // remotos: interpolação entre snapshots (~90ms de buffer)
  const renderTime = now - 90;
  let a = null, b = null;
  for (let i = state.snapshots.length - 1; i >= 0; i--) {
    const s = state.snapshots[i];
    if (s.arrival <= renderTime) { a = s; b = state.snapshots[i + 1] || null; break; }
  }
  if (!a) a = state.snapshots[state.snapshots.length - 1];

  for (const [id, r] of view.remotes) {
    const pa = a.players.get(id);
    if (!pa) { view.removeRemote(id); continue; }
    let x = pa.x, y = pa.y, z = pa.z, yaw = pa.yaw, pitch = pa.pitch;
    let walk = 0;
    if (b) {
      const pb = b.players.get(id);
      if (pb) {
        const t = a.arrival === b.arrival ? 1 : Math.max(0, Math.min(1, (renderTime - a.arrival) / (b.arrival - a.arrival)));
        x = lerp(pa.x, pb.x, t); y = lerp(pa.y, pb.y, t); z = lerp(pa.z, pb.z, t);
        yaw = lerpAngle(pa.yaw, pb.yaw, t);
        pitch = lerp(pa.pitch, pb.pitch, t);
        walk = Math.abs(pb.x - pa.x) + Math.abs(pb.z - pa.z) > 0.02 ? 1 : 0;
      }
    }
    view.setRemote(id, x, y, z, yaw, pitch, pa.hp, pa.alive, walk);

    // nametag projetada
    const tag = document.getElementById('nt-' + id);
    const proj = view.project(x, y + 2.25, z);
    if (proj && pa.alive) {
      if (!tag) {
        const div = document.createElement('div');
        div.id = 'nt-' + id;
        div.className = 'ntag';
        const info = state.roster.get(id);
        div.innerHTML = `<div class="nt-name" style="color:${info ? info.color : '#fff'}">${esc(info ? info.name : '?')}</div><div class="nt-hp"></div>`;
        document.getElementById('names-layer').appendChild(div);
        tag = div;
      }
      tag.style.left = proj.x + 'px';
      tag.style.top = proj.y + 'px';
      tag.style.display = 'block';
      const hpEl = tag.querySelector('.nt-hp');
      if (hpEl) hpEl.textContent = `${Math.max(0, Math.round(pa.hp))} HP`;
      tag.style.opacity = proj.depth > 0.97 ? '0.35' : '1';
    } else if (tag) {
      tag.style.display = 'none';
    }
  }
  // limpa nametags órfãs
  for (const el of document.querySelectorAll('.ntag')) {
    const id = Number(el.id.replace('nt-', ''));
    if (!view.remotes.has(id)) el.remove();
  }

  view.update(dt);
  view.render();
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// hint de clique
input.onLockChange = (locked) => {
  hud.clickHintShow(!locked && !state.menuOpen && !state.chatOpen);
};
