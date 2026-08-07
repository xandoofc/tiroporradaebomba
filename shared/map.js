// ============================================================
// Craft Strike — Mapa da arena "Craft Complex"
// Caixas AABB alinhadas aos eixos, estilo Minecraft.
// Formato: { x, y, z, sx, sy, sz, mat }
//   x,y,z = centro da caixa | sx,sy,sz = tamanhos | mat = material
// ============================================================

export const ARENA = 64;                 // tamanho do chão (m)
export const BOUNDS = { minX: -32, maxX: 32, minZ: -32, maxZ: 32 };
export const KILL_Y = -4;

// materiais disponíveis (usados no cliente para colorir)
export const MATS = ['grass', 'dirt', 'stone', 'plank', 'sand', 'brick', 'obsidian', 'water'];

function B(x, y, z, sx, sy, sz, mat) {
  return { x, y, z, sx, sy, sz, mat };
}

export const MAP_BOXES = [];

// ---- Chão (a "cara" de cima é grama, tratada separadamente no cliente) ----
MAP_BOXES.push(B(0, -0.5, 0, ARENA, 1, ARENA, 'grass'));

// ---- Muro perimetral ----
const W = 1, H = 4;
MAP_BOXES.push(B(0, H / 2, -32 + W / 2, ARENA + W * 2, H, W, 'stone'));
MAP_BOXES.push(B(0, H / 2, 32 - W / 2, ARENA + W * 2, H, W, 'stone'));
MAP_BOXES.push(B(-32 + W / 2, H / 2, 0, W, H, ARENA, 'stone'));
MAP_BOXES.push(B(32 - W / 2, H / 2, 0, W, H, ARENA, 'stone'));

// ---- Torres de canto com escadas (verticalidade) ----
const corner = (cx, cz) => {
  const dirX = Math.sign(cx), dirZ = Math.sign(cz);
  // 4 pilares
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      MAP_BOXES.push(B(cx + (i ? 1.4 : -1.4), 1.5, cz + (j ? 1.4 : -1.4), 1, 3, 1, 'stone'));
    }
  }
  // plataforma do topo
  MAP_BOXES.push(B(cx, 3.5, cz, 5, 1, 5, 'plank'));
  // escadas (4 degraus de 0.75)
  for (let s = 1; s <= 4; s++) {
    MAP_BOXES.push(B(cx - dirX * (3 + s * 0.55), 0.375 + (s - 1) * 0.75, cz - dirZ * (3 + s * 0.55), 1.1, 0.75, 1.1, 'brick'));
  }
};
corner(-28, -28);
corner(28, -28);
corner(-28, 28);
corner(28, 28);

// ---- Plataforma central elevada com pilares ----
MAP_BOXES.push(B(-3, 0.75, -3, 1, 1.5, 1, 'stone'));
MAP_BOXES.push(B(3, 0.75, -3, 1, 1.5, 1, 'stone'));
MAP_BOXES.push(B(-3, 0.75, 3, 1, 1.5, 1, 'stone'));
MAP_BOXES.push(B(3, 0.75, 3, 1, 1.5, 1, 'stone'));
MAP_BOXES.push(B(0, 1.75, 0, 10, 1, 10, 'plank'));
// caixotes em cima da plataforma
MAP_BOXES.push(B(-2.2, 2.8, -1.5, 1.2, 1.2, 1.2, 'brick'));
MAP_BOXES.push(B(2.3, 2.8, 1.4, 1.2, 1.2, 1.2, 'stone'));
MAP_BOXES.push(B(1.6, 2.9, -2.4, 1.0, 1.0, 1.0, 'plank'));

// ---- Passarelas elevadas (visadas de sniper) ----
const bridge = (z) => {
  MAP_BOXES.push(B(-16, 2.25, z, 1, 1.5, 1, 'stone'));
  MAP_BOXES.push(B(16, 2.25, z, 1, 1.5, 1, 'stone'));
  MAP_BOXES.push(B(0, 3.25, z, 30, 1, 4, 'plank'));
};
bridge(-14);
bridge(14);
// escadas até as passarelas
for (let s = 1; s <= 3; s++) {
  MAP_BOXES.push(B(24.5, 0.375 + (s - 1) * 0.75, -14, 1.1, 0.75, 1.1, 'brick'));
  MAP_BOXES.push(B(24.5, 0.375 + (s - 1) * 0.75, 14, 1.1, 0.75, 1.1, 'brick'));
}

// ---- Caixotes espalhados (cobertura) ----
const crates = [
  [-8, 0.5, -10, 'brick'], [-9.5, 0.5, -8.5, 'stone'], [-11, 1.25, -9, 'brick'],
  [8, 0.5, 10, 'plank'], [9.5, 1.25, 10, 'plank'], [9.5, 1.25, 8.5, 'stone'],
  [-14, 0.5, 6, 'stone'], [-14, 1.5, 6, 'stone'], [-12.5, 0.5, 7.5, 'brick'],
  [14, 0.5, -6, 'plank'], [14, 1.5, -6, 'plank'], [12.5, 0.5, -7.5, 'brick'],
  [-20, 0.5, -18, 'stone'], [20, 0.5, 18, 'stone'],
  [20, 0.5, -18, 'brick'], [-20, 0.5, 18, 'brick'],
  [0, 0.5, -22, 'stone'], [0, 0.5, 22, 'plank'], [-22, 0.5, 0, 'brick'], [22, 0.5, 0, 'stone'],
  [-4, 0.5, -18, 'plank'], [4, 0.5, 18, 'plank'],
  [0.5, 1.1, -7.8, 'obsidian'], [-0.5, 1.1, 7.8, 'obsidian'],
];
for (const [x, y, z, mat] of crates) {
  MAP_BOXES.push(B(x, y, z, 1, y * 2, 1, mat));
}
// caixote empilhado especial no meio (não bloqueia a visão da passarela)
MAP_BOXES.push(B(0, 0.5, -4, 1.4, 1, 1.4, 'plank'));
MAP_BOXES.push(B(0, 1.5, -4, 1.4, 1, 1.4, 'plank'));

// ---- Pontos de spawn (longe de paredes, escadas e caixotes) ----
export const SPAWNS = [
  { x: -21, y: 0, z: -21 }, { x: 21, y: 0, z: -21 },
  { x: -21, y: 0, z: 21 }, { x: 21, y: 0, z: 21 },
  { x: -14, y: 0, z: 2 }, { x: 14, y: 0, z: -2 },
  { x: -6, y: 0, z: -27 }, { x: 6, y: 0, z: 27 },
  { x: -27, y: 0, z: 6 }, { x: 27, y: 0, z: -6 },
];

export function randomSpawn() {
  const s = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
  return { x: s.x, y: s.y, z: s.z };
}
