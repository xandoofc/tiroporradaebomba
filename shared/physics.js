// ============================================================
// Craft Strike — Física compartilhada (servidor + cliente)
// Movimento estilo Counter-Strike simplificado + colisão AABB
// + raycast de tiros. 100% determinística: usada para
// simular no servidor E prever no cliente.
// ============================================================

import { GRAVITY, MAX_FALL, PLAYER, forwardVec, rightVec } from './constants.js';
import { BOUNDS, KILL_Y } from './map.js';

// ---------- Colisão AABB ----------

export function boxVsAABB(box, cx, cy, cz, hw, h) {
  return (
    cx + hw > box.x - box.sx / 2 && cx - hw < box.x + box.sx / 2 &&
    cy + h > box.y - box.sy / 2 && cy < box.y + box.sy / 2 &&
    cz + hw > box.z - box.sz / 2 && cz - hw < box.z + box.sz / 2
  );
}

// ---------- Movimento do jogador ----------

// p: { x,y,z, vx,vy,vz, onGround, yaw }
// input: { mx (strafe), my (frente/trás), jump }
// maxSpeed: velocidade alvo (depende da arma)
// Retorna nada; muta p. Também retorna flag de pulo.
export function movePlayer(p, input, boxes, maxSpeed, dt) {
  if (dt <= 0) return;

  const hw = PLAYER.halfW, h = PLAYER.height;
  const fwd = forwardVec(p.yaw, 0);
  const right = rightVec(p.yaw);

  // direção desejada (WASD)
  let wx = fwd.x * input.my + right.x * input.mx;
  let wz = fwd.z * input.my + right.z * input.mx;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }

  p.onGround = false;

  // ---- eixo X/Z (movimento horizontal) ----
  const speed = Math.hypot(p.vx, p.vz);
  if (p.onGroundPrev) {
    // atrito + aceleração no chão
    const wishX = wx * maxSpeed, wishZ = wz * maxSpeed;
    const accel = PLAYER.accelGround * dt;
    p.vx += clamp(wishX - p.vx, -accel, accel);
    p.vz += clamp(wishZ - p.vz, -accel, accel);
    if (len === 0) {
      const fr = PLAYER.friction * dt;
      const s = Math.hypot(p.vx, p.vz);
      if (s > 0) {
        const ns = Math.max(0, s - fr);
        p.vx *= ns / s; p.vz *= ns / s;
      }
    }
  } else {
    // controle de ar reduzido
    const wishX = wx * maxSpeed, wishZ = wz * maxSpeed;
    const accel = PLAYER.accelAir * dt;
    p.vx += clamp(wishX - p.vx, -accel, accel);
    p.vz += clamp(wishZ - p.vz, -accel, accel);
  }

  // ---- gravidade + pulo ----
  if (p.onGroundPrev && input.jump) {
    p.vy = PLAYER.jumpVel;
    p.onGround = false;
    p.jumped = true;
  } else {
    p.jumped = false;
  }
  p.vy = Math.max(p.vy - GRAVITY * dt, -MAX_FALL);

  // ---- integração + colisão por eixo ----
  const nxp = p.x + p.vx * dt;
  if (!collides(nxp, p.y, p.z, hw, h, boxes)) { p.x = nxp; } else { p.vx = 0; }
  if (p.vx === 0) p.x = snapAxis(p.x, p.y, p.z, hw, h, boxes, 'x');

  // eixo Y com sub-passos (evita atravessar caixas finas em queda rápida)
  let yRem = p.vy * dt;
  p.onGround = false;
  while (yRem !== 0) {
    const step = Math.abs(yRem) > 0.4 ? Math.sign(yRem) * 0.4 : yRem;
    const nyp = p.y + step;
    if (!collides(p.x, nyp, p.z, hw, h, boxes)) {
      p.y = nyp;
    } else {
      if (yRem < 0) p.onGround = true;
      p.vy = 0;
      p.y = snapAxis(p.x, p.y, p.z, hw, h, boxes, 'y');
      break;
    }
    yRem -= step;
  }

  const nzp = p.z + p.vz * dt;
  if (!collides(p.x, p.y, nzp, hw, h, boxes)) { p.z = nzp; } else { p.vz = 0; }
  if (p.vz === 0) p.z = snapAxis(p.x, p.y, p.z, hw, h, boxes, 'z');

  // ---- limites da arena ----
  p.x = clamp(p.x, BOUNDS.minX + hw, BOUNDS.maxX - hw);
  p.z = clamp(p.z, BOUNDS.minZ + hw, BOUNDS.maxZ - hw);
  if (p.y < KILL_Y) p.onGround = false;

  p.onGroundPrev = p.onGround;
}

function collides(x, y, z, hw, h, boxes) {
  for (let i = 0; i < boxes.length; i++) {
    if (boxVsAABB(boxes[i], x, y, z, hw, h)) return true;
  }
  return false;
}

// Empurra o jogador para fora da caixa no eixo dado
function snapAxis(x, y, z, hw, h, boxes, axis) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!boxVsAABB(b, x, y, z, hw, h)) continue;
    if (axis === 'x') {
      const dx = x - b.x;
      if (dx >= 0) return b.x + b.sx / 2 + hw;
      return b.x - b.sx / 2 - hw;
    }
    if (axis === 'y') {
      // subiu por baixo ou desceu por cima
      const dy = y - b.y;
      if (dy >= 0) return b.y + b.sy / 2;      // piso em cima da caixa
      return b.y - b.sy / 2 - h;               // teto
    }
    const dz = z - b.z;
    if (dz >= 0) return b.z + b.sz / 2 + hw;
    return b.z - b.sz / 2 - hw;
  }
  return axis === 'y' ? y : axis === 'x' ? x : z;
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// ---------- Raycast contra AABB (método do slab) ----------

// Retorna t (distância) ou null
export function rayBox(o, d, box) {
  const bminx = box.x - box.sx / 2, bmaxx = box.x + box.sx / 2;
  const bminy = box.y - box.sy / 2, bmaxy = box.y + box.sy / 2;
  const bminz = box.z - box.sz / 2, bmaxz = box.z + box.sz / 2;
  let tmin = 0, tmax = Infinity;
  if (Math.abs(d.x) < 1e-9) {
    if (o.x < bminx || o.x > bmaxx) return null;
  } else {
    let t1 = (bminx - o.x) / d.x, t2 = (bmaxx - o.x) / d.x;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(d.y) < 1e-9) {
    if (o.y < bminy || o.y > bmaxy) return null;
  } else {
    let t1 = (bminy - o.y) / d.y, t2 = (bmaxy - o.y) / d.y;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(d.z) < 1e-9) {
    if (o.z < bminz || o.z > bmaxz) return null;
  } else {
    let t1 = (bminz - o.z) / d.z, t2 = (bmaxz - o.z) / d.z;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin >= 0 ? tmin : null;
}

// Raycast contra o mapa (todas as caixas). Retorna { t, box } ou null.
export function rayMap(o, d, boxes, maxDist) {
  let best = null, bestT = maxDist ?? Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(o, d, boxes[i]);
    if (t !== null && t < bestT) { bestT = t; best = boxes[i]; }
  }
  return best ? { t: bestT, box: best } : null;
}

// ---------- Util ----------

export function dist3(ax, ay, az, bx, by, bz) {
  return Math.hypot(ax - bx, ay - by, az - bz);
}
