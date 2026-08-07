// ============================================================
// Craft Strike — Smoke test do cliente (sem navegador)
// Valida que os builders 3D funcionam com o Three.js vendor
// e que a física compartilhada se comporta bem.
// Uso: node test/client.smoke.js
// ============================================================

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THREE_URL = pathToFileURL(path.join(__dirname, '..', 'public', 'vendor', 'three.module.min.js')).href;

// mapeia o import 'three' (que no browser resolve pelo importmap) para o vendor local
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// ---- stubs mínimos de DOM ----
const fakeCtx = () => ({
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
  fillRect() {}, fillStyle: '', globalAlpha: 1,
});
globalThis.document = {
  createElement: () => ({ getContext: fakeCtx, width: 0, height: 0 }),
  getElementById: () => null,
  addEventListener() {},
  querySelectorAll: () => [],
  body: { appendChild() {} },
};
globalThis.window = {
  innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
  addEventListener() {}, AudioContext: undefined, requestAnimationFrame: () => 0,
  location: { protocol: 'http:', host: 'x' },
};
globalThis.requestAnimationFrame = () => 0;

const THREE = (await import(THREE_URL)).default;

const { buildWorld, buildPlayerModel, buildWeaponModel } = await import('../public/js/models.js');
const { movePlayer, rayBox, rayMap } = await import('../shared/physics.js');
const { MAP_BOXES } = await import('../shared/map.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('  ✔', l); } else { failed++; console.error('  ✘', l); } };

// 1) mundo
const { world, clouds } = buildWorld();
ok(world && world.children.length > 3, 'mundo construído com céu, chão e mapa');
ok(clouds.length > 0, 'nuvens criadas');

// 2) jogador
const p = buildPlayerModel('#ff0000', 2);
ok(!!p.userData.parts, 'modelo de jogador tem partes animáveis');
p.setWalk(1, 1);
p.setPitch(0.3);
ok(Math.abs(p.userData.parts.head.rotation.x - 0.3) < 1e-6, 'setPitch inclina a cabeça');

// 3) armas
for (const k of ['ak47', 'awp', 'deagle', 'knife']) {
  const w = buildWeaponModel(k);
  ok(w.userData.muzzle.z < -0.2 && w.userData.reloadPivot.children.length >= 4, `viewmodel ${k} ok (muzzle z=${w.userData.muzzle.z.toFixed(2)})`);
}

// 4) física: andar
const player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, onGround: false, onGroundPrev: true };
for (let i = 0; i < 30; i++) movePlayer(player, { mx: 0, my: 1, jump: false }, MAP_BOXES, 6.8, 1 / 30);
ok(player.z < -2, `anda para frente (z=${player.z.toFixed(2)})`);
ok(Math.abs(player.y) < 0.5, 'continua no chão');

// 5) física: pulo (mede o pico, não o final — após 1s já voltou ao chão)
const pj = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, onGround: false, onGroundPrev: true };
let maxY = 0;
for (let i = 0; i < 30; i++) { movePlayer(pj, { mx: 0, my: 0, jump: i === 0 }, MAP_BOXES, 6.8, 1 / 30); maxY = Math.max(maxY, pj.y); }
ok(maxY > 0.8, `pulo sobe (pico y=${maxY.toFixed(2)})`);

// 6) física: não atravessa parede (com chão — sem chão o jogador cai e passa por baixo)
const floor = { x: 0, y: -0.5, z: -20, sx: 60, sy: 1, sz: 60 };
const wall = { x: 0, y: 2, z: -8, sx: 20, sy: 4, sz: 1 };
const pw = { x: 0, y: 0, z: -5, vx: 0, vy: 0, vz: 0, yaw: 0, onGround: false, onGroundPrev: true };
for (let i = 0; i < 180; i++) movePlayer(pw, { mx: 0, my: 1, jump: false }, [floor, wall], 6.8, 1 / 30);
ok(pw.z > -8.2, `não atravessa parede (z=${pw.z.toFixed(2)})`);

// 6b) salta sobre o muro? (muro tem 4m, pulo chega ~1.8m — deve bloquear mesmo pulando)
const pw2 = { x: 0, y: 0, z: -5, vx: 0, vy: 0, vz: 0, yaw: 0, onGround: false, onGroundPrev: true };
for (let i = 0; i < 180; i++) movePlayer(pw2, { mx: 0, my: 1, jump: i < 30 }, [floor, wall], 6.8, 1 / 30);
ok(pw2.z > -8.2, `muro alto bloqueia mesmo com pulo (z=${pw2.z.toFixed(2)})`);

// 7) raycast
const hit = rayBox({ x: 0, y: 1, z: -2 }, { x: 0, y: 0, z: -1 }, wall);
ok(hit !== null && Math.abs(hit - 5.5) < 0.01, `raycast na parede em t=${hit}`);
const miss = rayBox({ x: 0, y: 1, z: -2 }, { x: 0, y: 0, z: -1 }, { x: 100, y: 2, z: 100, sx: 1, sy: 1, sz: 1 });
ok(miss === null, 'raycast erra caixa distante');
const mapHit = rayMap({ x: 0, y: 1.62, z: 0 }, { x: 0, y: 0, z: -1 }, MAP_BOXES, 160);
ok(mapHit && mapHit.t < 160, `raycast atinge o mapa (t=${mapHit ? mapHit.t.toFixed(1) : '?'})`);

console.log(`\nSmoke test cliente: ${passed} passaram, ${failed} falharam`);
process.exit(failed === 0 ? 0 : 1);
