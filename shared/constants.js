// ============================================================
// Craft Strike — Constantes compartilhadas (servidor + cliente)
// ============================================================

export const GAME_NAME = 'Craft Strike';

export const TICK_RATE = 30;              // ticks por segundo (simulação do servidor)
export const TICK_MS = 1000 / TICK_RATE;

export const GRAVITY = 20;                // m/s²
export const MAX_FALL = 28;               // velocidade terminal de queda

export const PLAYER = {
  halfW: 0.35,        // meia largura (AABB)
  height: 1.8,        // altura total
  eye: 1.62,          // altura dos olhos
  headH: 0.42,        // altura da caixa da cabeça (acima do topo do corpo)
  runSpeed: 6.8,      // m/s velocidade de caminhada base
  accelGround: 60,    // aceleração no chão
  accelAir: 12,       // aceleração no ar (controle de ar limitado)
  friction: 9,        // atrito no chão
  jumpVel: 8.4,       // impulso do pulo
};

export const SENSITIVITY = 0.0022;        // rad por pixel (cliente)
export const PITCH_LIMIT = 1.55;          // ~89° (cliente + servidor)
export const YAW_BASE = 0;                // yaw=0 -> olhando para -Z

export const GUN_RANGE = 160;             // alcance máximo de tiro (m)
export const RESPAWN_TIME_MS = 2500;      // tempo de respawn
export const SWITCH_MS = 260;             // tempo para trocar de arma

export const KILL_FLOOR = -4;             // abaixo disso = morte (caiu do mapa)
export const WEAPON_START = 'ak47';

export const COLORS = [
  '#ff5b5b', '#5bc4ff', '#6bff7a', '#ffe35b',
  '#ff8a5b', '#c47bff', '#ff5bd8', '#5bffef',
  '#ffb45b', '#a8ff5b',
];

// Convenção de vetores (three.js / câmera olha -Z):
//   forward = (−sin yaw·cos pitch, sin pitch, −cos yaw·cos pitch)
//   right   = (cos yaw, 0, −sin yaw)
export function forwardVec(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}
export function rightVec(yaw) {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}
