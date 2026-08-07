// ============================================================
// Craft Strike — Modelos 3D (tudo blocky, estilo Minecraft)
// ============================================================

import * as THREE from 'three';
import { MAP_BOXES, ARENA } from '../../shared/map.js';

// ---------- cores dos blocos ----------

const MAT_COLORS = {
  grass:    [0.42, 0.78, 0.30],
  dirt:     [0.55, 0.42, 0.30],
  stone:    [0.52, 0.53, 0.56],
  plank:    [0.66, 0.51, 0.34],
  sand:     [0.83, 0.78, 0.60],
  brick:    [0.62, 0.36, 0.30],
  obsidian: [0.16, 0.15, 0.21],
  water:    [0.25, 0.55, 0.85],
};

function hash3(a, b, c) {
  let h = a * 374761393 + b * 668265263 + c * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

// ---------- mapa ----------

// Une todas as caixas do mapa em UMA geometria com vertex colors
// (1 draw call, tons de bloco variados como no Minecraft)
export function buildWorld() {
  const world = new THREE.Group();

  // céu
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 2; skyCanvas.height = 256;
  const sctx = skyCanvas.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4a90d9');
  grad.addColorStop(0.55, '#8fc3ee');
  grad.addColorStop(1, '#d8ecf9');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(240, 16, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  sky.renderOrder = -10;
  world.add(sky);

  // nuvens (alguns blocos brancos flutuando — bem Minecraft)
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, fog: false });
  const clouds = [];
  const cloudSpots = [[-18, 26], [12, 20], [24, -14], [-8, -30], [30, 12], [-30, -6], [4, -8]];
  for (const [cx, cz] of cloudSpots) {
    const cloud = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const s = 3 + ((i * 7) % 3);
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, 1.4, s * 0.8), cloudMat);
      m.position.set(i * 2.6 - 4, (i % 2) * 0.5, (i % 3) * 1.5 - 1.5);
      cloud.add(m);
    }
    cloud.position.set(cx, 34, cz);
    cloud.userData.baseX = cx;
    cloud.userData.speed = 0.4 + hash3(cx, 0, cz) * 0.5;
    world.add(cloud);
    clouds.push(cloud);
  }

  // chão (grama em cima, terra nas laterais)
  const groundGeo = new THREE.BoxGeometry(ARENA, 1, ARENA);
  const dirtSide = new THREE.MeshLambertMaterial({ color: 0x8a7a5c });
  const dirtSide2 = new THREE.MeshLambertMaterial({ color: 0x7a6b4e });
  const ground = new THREE.Mesh(groundGeo, [
    dirtSide, dirtSide2,                       // +x, -x
    new THREE.MeshLambertMaterial({ color: 0x63c94f }), // topo (grama)
    new THREE.MeshLambertMaterial({ color: 0x5c4a33 }), // fundo
    dirtSide2, dirtSide,
  ]);
  ground.receiveShadow = true;
  world.add(ground);

  // caixas do mapa (1 draw call com vertex colors)
  const positions = [], normals = [], colors = [], indices = [];
  const base = new THREE.BoxGeometry(1, 1, 1);
  const bp = base.attributes.position.array;
  const bn = base.attributes.normal.array;
  const bi = base.index.array;
  const faceTone = [1.04, 0.94, 1.14, 0.78, 0.98, 0.9]; // +x -x +y -y +z -z
  let vbase = 0;
  for (const b of MAP_BOXES) {
    const c = MAT_COLORS[b.mat] || MAT_COLORS.stone;
    const vary = 0.86 + 0.28 * hash3(b.x, b.y, b.z);
    for (let v = 0; v < 24; v++) {
      const f = Math.floor(v / 4);
      const t = faceTone[f] * vary;
      positions.push(bp[v * 3] * b.sx + b.x, bp[v * 3 + 1] * b.sy + b.y, bp[v * 3 + 2] * b.sz + b.z);
      normals.push(bn[v * 3], bn[v * 3 + 1], bn[v * 3 + 2]);
      colors.push(c[0] * t, c[1] * t, c[2] * t);
    }
    for (let i = 0; i < 36; i++) indices.push(bi[i] + vbase);
    vbase += 24;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  const mapMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mapMesh.castShadow = true;
  mapMesh.receiveShadow = true;
  world.add(mapMesh);

  return { world, clouds };
}

// ---------- jogador (blocky) ----------

const SKIN_TONES = [0xd9a066, 0xc68b59, 0x8d5524, 0xe0ac69, 0xa97450, 0xf1c27d, 0x6b4226, 0xb5651d];

export function buildPlayerModel(color, skinIdx) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: SKIN_TONES[skinIdx % SKIN_TONES.length] });
  const shirt = new THREE.MeshLambertMaterial({ color });
  const pants = new THREE.MeshLambertMaterial({ color: 0x31455c });
  const shoe = new THREE.MeshLambertMaterial({ color: 0x1e1e1e });
  const eye = new THREE.MeshBasicMaterial({ color: 0x101010 });

  const shadowOpts = { castShadow: true };

  // pernas
  const legGeo = new THREE.BoxGeometry(0.26, 0.72, 0.26);
  const legL = new THREE.Mesh(legGeo, pants, shadowOpts); legL.position.set(0, -0.36, 0);
  const legR = new THREE.Mesh(legGeo, pants, shadowOpts); legR.position.set(0, -0.36, 0);
  const shoeGeo = new THREE.BoxGeometry(0.28, 0.1, 0.36);
  const shoeL = new THREE.Mesh(shoeGeo, shoe, shadowOpts); shoeL.position.set(0, -0.78, -0.03);
  const shoeR = new THREE.Mesh(shoeGeo, shoe, shadowOpts); shoeR.position.set(0, -0.78, -0.03);
  const legPivotL = new THREE.Group(); legPivotL.position.set(-0.16, 0.72, 0); legPivotL.add(legL, shoeL);
  const legPivotR = new THREE.Group(); legPivotR.position.set(0.16, 0.72, 0); legPivotR.add(legR, shoeR);

  // torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.74, 0.34), shirt, shadowOpts);
  torso.position.set(0, 1.09, 0);

  // braços + mãos
  const armGeo = new THREE.BoxGeometry(0.22, 0.68, 0.26);
  const armL = new THREE.Mesh(armGeo, shirt, shadowOpts); armL.position.set(0, -0.34, 0);
  const armR = new THREE.Mesh(armGeo, shirt, shadowOpts); armR.position.set(0, -0.34, 0);
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.26), skin, shadowOpts); handL.position.set(0, -0.72, 0);
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.26), skin, shadowOpts); handR.position.set(0, -0.72, 0);
  const armPivotL = new THREE.Group(); armPivotL.position.set(-0.42, 1.46, 0); armPivotL.add(armL, handL);
  const armPivotR = new THREE.Group(); armPivotR.position.set(0.42, 1.46, 0); armPivotR.add(armR, handR);

  // cabeça (frente = -Z)
  const head = new THREE.Group(); head.position.set(0, 1.46, 0);
  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin, shadowOpts);
  headMesh.position.set(0, 0.25, 0);
  const eyeGeo = new THREE.BoxGeometry(0.07, 0.07, 0.04);
  const eyeL = new THREE.Mesh(eyeGeo, eye); eyeL.position.set(-0.11, 0.29, -0.26);
  const eyeR = new THREE.Mesh(eyeGeo, eye); eyeR.position.set(0.11, 0.29, -0.26);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.03), eye);
  brow.position.set(0, 0.36, -0.26);
  head.add(headMesh, eyeL, eyeR, brow);

  g.add(torso, legPivotL, legPivotR, armPivotL, armPivotR, head);
  g.userData.parts = { legPivotL, legPivotR, armPivotL, armPivotR, head };
  g.userData.walkPhase = Math.random() * Math.PI * 2;

  g.setWalk = (phase, amount) => {
    const p = g.userData.parts;
    p.legPivotL.rotation.x = Math.sin(phase) * 0.7 * amount;
    p.legPivotR.rotation.x = -Math.sin(phase) * 0.7 * amount;
    p.armPivotL.rotation.x = -Math.sin(phase) * 0.55 * amount;
    p.armPivotR.rotation.x = Math.sin(phase) * 0.55 * amount;
  };
  g.setPitch = (pitch) => {
    g.userData.parts.head.rotation.x = pitch;
  };
  return g;
}

// ---------- armas (viewmodel, cano aponta -Z) ----------

const METAL = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
const METAL_D = new THREE.MeshLambertMaterial({ color: 0x1d2025 });
const WOOD = new THREE.MeshLambertMaterial({ color: 0x6d4f2b });
const GRIP = new THREE.MeshLambertMaterial({ color: 0x3a2c1c });
const ACC = new THREE.MeshLambertMaterial({ color: 0x8a8f98 });

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

export function buildWeaponModel(kind) {
  const g = new THREE.Group();
  let muzzle = new THREE.Vector3(0, 0, -0.5);

  const add = (mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    g.add(mesh);
  };

  if (kind === 'ak47') {
    add(box(0.09, 0.11, 0.4, METAL), 0, 0, 0.02);
    add(box(0.05, 0.05, 0.5, METAL_D), 0, 0.02, -0.42);
    add(box(0.07, 0.06, 0.18, WOOD), 0, -0.03, -0.26);
    add(box(0.06, 0.03, 0.26, METAL_D), 0, 0.06, -0.14);
    add(box(0.07, 0.17, 0.09, METAL), 0, -0.13, 0.02, 0.25);
    add(box(0.07, 0.1, 0.2, WOOD), 0, -0.02, 0.32);
    add(box(0.06, 0.12, 0.07, GRIP), 0, -0.11, 0.14, 0.4);
    add(box(0.02, 0.05, 0.02, METAL_D), 0, 0.09, -0.58);
    add(box(0.03, 0.04, 0.03, METAL_D), 0, 0.09, 0.12);
    muzzle = new THREE.Vector3(0, 0.02, -0.7);
  } else if (kind === 'awp') {
    add(box(0.06, 0.06, 0.85, METAL_D), 0, 0, -0.5);
    add(box(0.09, 0.1, 0.4, METAL), 0, 0, 0.02);
    add(box(0.05, 0.06, 0.3, METAL), 0, 0.11, -0.04);
    add(box(0.07, 0.02, 0.24, ACC), 0, 0.12, -0.04);
    add(box(0.08, 0.13, 0.3, WOOD), 0, -0.03, 0.36);
    add(box(0.07, 0.13, 0.08, GRIP), 0, -0.11, 0.1, 0.35);
    add(box(0.06, 0.1, 0.16, METAL), 0, -0.09, -0.12);
    add(box(0.07, 0.02, 0.03, ACC), 0, 0.08, -0.94);
    muzzle = new THREE.Vector3(0, 0.005, -0.95);
  } else if (kind === 'deagle') {
    add(box(0.07, 0.09, 0.24, METAL), 0, 0, 0);
    add(box(0.05, 0.06, 0.12, METAL_D), 0, 0.01, -0.16);
    add(box(0.07, 0.05, 0.1, METAL), 0, -0.05, 0.04);
    add(box(0.06, 0.13, 0.09, GRIP), 0, -0.12, 0.06, 0.3);
    add(box(0.02, 0.04, 0.02, ACC), 0, 0.07, -0.22);
    add(box(0.03, 0.03, 0.02, ACC), 0, 0.07, 0.12);
    muzzle = new THREE.Vector3(0, 0.01, -0.25);
  } else if (kind === 'knife') {
    const blade = box(0.04, 0.09, 0.2, ACC);
    blade.geometry.translate(0, 0, -0.09);
    add(blade, 0, 0.01, -0.1, 0.12);
    add(box(0.06, 0.13, 0.03, METAL), 0, 0.01, -0.02);
    add(box(0.05, 0.07, 0.13, GRIP), 0, 0.02, 0.07, -0.08);
    add(box(0.05, 0.04, 0.03, METAL_D), 0, 0.0, 0.15);
    muzzle = new THREE.Vector3(0, 0.05, -0.24);
  }

  // pivot de recarga (a arma inteira desce/gira)
  const reloadPivot = new THREE.Group();
  reloadPivot.position.set(0, 0, 0);
  while (g.children.length) reloadPivot.add(g.children[0]);
  g.add(reloadPivot);

  g.userData = { muzzle, reloadPivot };
  return g;
}

// ---------- efeitos ----------

export function makeMuzzleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,230,1)');
  gr.addColorStop(0.4, 'rgba(255,214,90,.9)');
  gr.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeGlowTexture(color = '255,120,40') {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  gr.addColorStop(0, `rgba(255,255,255,1)`);
  gr.addColorStop(0.35, `rgba(${color},.8)`);
  gr.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
