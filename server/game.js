// ============================================================
// Craft Strike — Simulação do jogo (servidor)
// FFA com respawn infinito, hitscan server-side, 4 armas.
// ============================================================

import {
  PLAYER, SENSITIVITY, PITCH_LIMIT, GUN_RANGE,
  RESPAWN_TIME_MS, SWITCH_MS, WEAPON_START, forwardVec, COLORS,
} from '../shared/constants.js';
import { WEAPONS, currentSpread } from '../shared/weapons.js';
import { MAP_BOXES, randomSpawn, KILL_Y } from '../shared/map.js';
import { movePlayer, rayMap, rayBox, dist3 } from '../shared/physics.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Game {
  constructor() {
    this.players = new Map();
    this.events = [];
    this.time = 0;
    this._colorIdx = 0;
  }

  // ---------------- gerenciamento de jogadores ----------------

  addPlayer(id, name) {
    const p = {
      id, name, color: COLORS[this._colorIdx++ % COLORS.length],
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      yaw: (Math.random() - 0.5) * Math.PI, pitch: 0,
      onGround: false, onGroundPrev: false,
      hp: 100, weapon: WEAPON_START,
      weaponAmmo: {
        ak47: { mag: WEAPONS.ak47.mag, res: WEAPONS.ak47.reserve },
        awp: { mag: WEAPONS.awp.mag, res: WEAPONS.awp.reserve },
        deagle: { mag: WEAPONS.deagle.mag, res: WEAPONS.deagle.reserve },
        knife: null,
      },
      alive: true, respawnAt: 0,
      score: 0, deaths: 0, kills: 0, streak: 0,
      lastFireAt: -10, reloadUntil: 0, switchUntil: 0, shotsFired: 0, scoped: false,
      input: { mx: 0, my: 0, jump: false, fire: false, alt: false },
      prevFire: false, prevAlt: false,
    };
    this.spawn(p);
    this.players.set(id, p);
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  spawn(p) {
    const s = randomSpawn();
    p.x = s.x; p.y = s.y; p.z = s.z;
    p.vx = p.vy = p.vz = 0;
    p.hp = 100;
    p.alive = true;
    p.weapon = WEAPON_START;
    p.weaponAmmo.ak47 = { mag: WEAPONS.ak47.mag, res: WEAPONS.ak47.reserve };
    p.weaponAmmo.awp = { mag: WEAPONS.awp.mag, res: WEAPONS.awp.reserve };
    p.weaponAmmo.deagle = { mag: WEAPONS.deagle.mag, res: WEAPONS.deagle.reserve };
    p.lastFireAt = -10; p.reloadUntil = 0; p.switchUntil = 0; p.shotsFired = 0;
    p.scoped = false;
    this.events.push({ k: 'respawn', id: p.id });
  }

  forceRespawn(id) {
    const p = this.players.get(id);
    if (p && !p.alive) this.spawn(p);
  }

  // ---------------- entrada ----------------

  applyInput(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    if (msg.yaw !== undefined && msg.pitch !== undefined) {
      // modo absoluto (usado em testes/cheat p/ diagnóstico)
      p.yaw = msg.yaw;
      p.pitch = clamp(msg.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    } else {
      p.yaw = p.yaw - (msg.mx || 0) * SENSITIVITY;
      p.pitch = clamp(p.pitch - (msg.my || 0) * SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
    }
    const k = msg.k || 0;
    p.input.mx = (k & 4 ? -1 : 0) + (k & 8 ? 1 : 0);
    p.input.my = (k & 1 ? 1 : 0) + (k & 2 ? -1 : 0);
    p.input.jump = (k & 16) !== 0;
    p.input.fire = !!msg.fire;
    p.input.alt = !!msg.alt;
    if (msg.reload) this.startReload(p);
    if (msg.weapon) this.switchWeapon(p, msg.weapon);
  }

  startReload(p) {
    const w = WEAPONS[p.weapon];
    if (!w || w.kind === 'melee') return;
    const ammo = p.weaponAmmo[p.weapon];
    if (!ammo || ammo.mag >= w.mag || ammo.res <= 0) return;
    if (p.reloadUntil > this.time) return;
    p.reloadUntil = this.time + w.reloadMs / 1000;
    this.events.push({ k: 'reload', id: p.id });
  }

  switchWeapon(p, name) {
    if (name === p.weapon || !WEAPONS[name]) return;
    p.weapon = name;
    p.switchUntil = this.time + SWITCH_MS / 1000;
    p.reloadUntil = 0;
    p.scoped = false;
    p.shotsFired = 0;
    this.events.push({ k: 'switch', id: p.id, w: name });
  }

  // ---------------- tick ----------------

  tick(dt) {
    this.time += dt;
    const now = this.time;

    for (const p of this.players.values()) {
      if (p.alive) {
        // velocidade depende da arma (AWP mais lenta, scoped mais lento ainda)
        const w = WEAPONS[p.weapon];
        let mult = w ? w.moveMult : 1;
        if (p.scoped) mult *= 0.5;
        movePlayer(p, p.input, MAP_BOXES, 6.8 * mult, dt);

        // caiu do mapa
        if (p.y < KILL_Y) this.kill(null, p, 'fall', false);

        // disparos
        const heldFire = p.input.fire;
        const edgeFire = heldFire && !p.prevFire;
        const edgeAlt = p.input.alt && !p.prevAlt;
        if (p.weapon === 'awp') p.scoped = p.input.alt;
        else if (edgeAlt) this.tryFire(p, true);
        if (w && w.auto) { if (heldFire) this.tryFire(p, false); }
        else if (edgeFire) this.tryFire(p, false);
        p.prevFire = heldFire;
        p.prevAlt = p.input.alt;

        // recuo/spread decai com o tempo
        p.shotsFired = Math.max(0, p.shotsFired - dt * 8);

        // término do reload
        if (p.reloadUntil > 0 && now >= p.reloadUntil) {
          p.reloadUntil = 0;
          const ammo = p.weaponAmmo[p.weapon];
          const w2 = WEAPONS[p.weapon];
          if (ammo && w2) {
            const need = w2.mag - ammo.mag;
            const take = Math.min(need, ammo.res);
            ammo.mag += take; ammo.res -= take;
            this.events.push({ k: 'reloadend', id: p.id });
          }
        }
      }
    }

    // respawns agendados
    for (const p of this.players.values()) {
      if (!p.alive && now >= p.respawnAt) this.spawn(p);
    }
  }

  // ---------------- disparo ----------------

  tryFire(p, alt) {
    const now = this.time;
    const w = WEAPONS[p.weapon];
    const fireDelay = alt ? (w.altMs || w.fireMs) : w.fireMs;
    if (now < p.lastFireAt + fireDelay / 1000) return;
    if (now < p.switchUntil) return;
    if (now < p.reloadUntil) return;
    p.lastFireAt = now;

    if (w.kind === 'melee') { this.melee(p, w, alt); return; }

    const ammo = p.weaponAmmo[p.weapon];
    if (!ammo || ammo.mag <= 0) {
      this.events.push({ k: 'dry', id: p.id });
      this.startReload(p);
      return;
    }
    ammo.mag--;
    p.shotsFired++;

    const o = { x: p.x, y: p.y + PLAYER.eye, z: p.z };
    const moving = Math.hypot(p.vx, p.vz) > 0.5;
    const spread = currentSpread(w, p.shotsFired, moving);
    const dir = spreadDir(p.yaw, p.pitch, spread);

    const tMap = rayMap(o, dir, MAP_BOXES, GUN_RANGE);
    let hitT = tMap ? tMap.t : GUN_RANGE;
    let hitPlayer = null;

    for (const q of this.players.values()) {
      if (q.id === p.id || !q.alive) continue;
      const t = rayPlayer(o, dir, q);
      if (t !== null && t < hitT) { hitT = t; hitPlayer = q; }
    }

    const end = { x: o.x + dir.x * hitT, y: o.y + dir.y * hitT, z: o.z + dir.z * hitT };
    let hit = false;
    if (hitPlayer) {
      hit = true;
      const hs = this.isHeadshot(o, dir, hitPlayer, hitT);
      this.damage(hitPlayer, w.dmg * (hs ? w.hsMult : 1), p, w.name, hs);
    }
    this.events.push({ k: 'shot', id: p.id, f: [o.x, o.y, o.z], t: [end.x, end.y, end.z], w: p.weapon, h: hit });

    // recarga automática ao zerar o pente
    if (ammo.mag === 0 && ammo.res > 0) this.startReload(p);
  }

  melee(p, w, alt) {
    const o = { x: p.x, y: p.y + PLAYER.eye, z: p.z };
    const dir = forwardVec(p.yaw, p.pitch);
    const range = alt ? w.altRange : w.range;
    const cone = alt ? 0.72 : w.coneDot;
    const dmg = alt ? w.altDmg : w.dmg;

    // oclusão: faca não atravessa parede
    const occl = rayMap(o, dir, MAP_BOXES, range);
    const maxT = occl ? occl.t : range;

    let best = null, bestScore = Infinity;
    for (const q of this.players.values()) {
      if (q.id === p.id || !q.alive) continue;
      const cx = q.x, cy = q.y + PLAYER.height / 2, cz = q.z;
      const d = dist3(o.x, o.y, o.z, cx, cy, cz);
      if (d > maxT) continue;
      const nx = (cx - o.x) / d, ny = (cy - o.y) / d, nz = (cz - o.z) / d;
      const dot = nx * dir.x + ny * dir.y + nz * dir.z;
      if (dot < cone) continue;
      if (d < bestScore) { bestScore = d; best = q; }
    }
    if (best) this.damage(best, dmg, p, w.name, false);
    this.events.push({ k: 'shot', id: p.id, w: p.weapon, alt: alt ? 1 : 0, h: !!best });
  }

  isHeadshot(o, dir, q, hitT) {
    const head = {
      x: q.x, y: q.y + PLAYER.height - PLAYER.headH / 2,
      z: q.z, sx: 0.44, sy: PLAYER.headH, sz: 0.44,
    };
    const t = rayBox(o, dir, head);
    return t !== null && t <= hitT + 0.001;
  }

  damage(q, dmg, attacker, weaponName, hs) {
    if (!q.alive) return;
    q.hp -= dmg;
    const from = attacker ? [attacker.x, attacker.y + PLAYER.eye, attacker.z] : null;
    this.events.push({ k: 'hurt', id: q.id, d: dmg, hs: hs ? 1 : 0, f: from });
    if (q.hp <= 0) this.kill(attacker, q, weaponName, hs);
  }

  kill(attacker, victim, weaponName, hs) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = this.time + RESPAWN_TIME_MS / 1000;

    if (attacker) {
      attacker.score++;
      attacker.kills++;
      attacker.streak++;
      if (attacker.streak === 3 || attacker.streak === 5 || attacker.streak === 10) {
        this.events.push({ k: 'streak', id: attacker.id, n: attacker.streak });
      }
    }
    this.events.push({
      k: 'kill', kid: attacker ? attacker.id : null, vid: victim.id,
      w: weaponName || '', hs: hs ? 1 : 0, t: Math.round(this.time * 1000),
    });
  }

  // ---------------- estado ----------------

  chat(id, text) {
    this.events.push({ k: 'chat', id, m: String(text).slice(0, 120) });
  }

  sysMsg(text) {
    this.events.push({ k: 'sys', m: text });
  }

  buildState() {
    const s = [];
    for (const p of this.players.values()) {
      const ammo = p.weaponAmmo[p.weapon];
      s.push([
        p.id,
        Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100,
        Math.round(p.yaw * 1000) / 1000, Math.round(p.pitch * 1000) / 1000,
        p.hp, p.weapon, ammo ? ammo.mag : 0, ammo ? ammo.res : 0,
        p.alive ? 1 : 0, p.score, p.deaths, p.streak,
      ]);
    }
    return s;
  }

  roster() {
    const p = [];
    for (const pl of this.players.values()) p.push({ id: pl.id, name: pl.name, color: pl.color });
    return p;
  }

  flushEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

// ---------- helpers ----------

// Desloca a direção de tiro dentro de um cone aleatório (spread).
function spreadDir(yaw, pitch, spread) {
  const base = forwardVec(yaw, pitch);
  // base ortonormal {base, u, v} ao redor da mira
  const refUp = Math.abs(base.y) < 0.98 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let ux = refUp.y * base.z - refUp.z * base.y;
  let uy = refUp.z * base.x - refUp.x * base.z;
  let uz = refUp.x * base.y - refUp.y * base.x;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = base.y * uz - base.z * uy;
  const vy = base.z * ux - base.x * uz;
  const vz = base.x * uy - base.y * ux;
  const a = Math.random() * Math.PI * 2;
  const r = spread * Math.sqrt(Math.random()); // uniforme dentro do disco
  const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
  return {
    x: base.x + ux * dx + vx * dy,
    y: base.y + uy * dx + vy * dy,
    z: base.z + uz * dx + vz * dy,
  };
}

function rayPlayer(o, dir, q) {
  const body = { x: q.x, y: q.y, z: q.z, sx: PLAYER.halfW * 2, sy: PLAYER.height, sz: PLAYER.halfW * 2 };
  const head = {
    x: q.x, y: q.y + PLAYER.height - PLAYER.headH / 2,
    z: q.z, sx: 0.44, sy: PLAYER.headH, sz: 0.44,
  };
  const tb = rayBox(o, dir, body);
  const th = rayBox(o, dir, head);
  if (tb === null && th === null) return null;
  if (tb === null) return th;
  if (th === null) return tb;
  return Math.min(tb, th);
}
