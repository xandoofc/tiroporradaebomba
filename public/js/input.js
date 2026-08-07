// ============================================================
// Craft Strike — Entrada (teclado + mouse + pointer lock)
// ============================================================

import { WEAPON_KEYS } from '../../shared/weapons.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.mx = 0;          // deltas de mouse acumulados (consumidos no poll)
    this.my = 0;
    this.fire = false;
    this.alt = false;
    this.locked = false;
    this.reloadPending = false;
    this.reloadHold = 0;
    this.weaponQueued = null;

    this.onLockChange = null;
    this.onWeapon = null;
    this.onScoreboard = null;   // (active)
    this.onChat = null;         // pede para abrir o chat
    this.onMute = null;

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.keys[e.code] = true;
      if (e.code === 'KeyR') { this.reloadPending = true; this.reloadHold = 2; }
      if (e.code === 'KeyM') this.onMute && this.onMute();
      if (e.code === 'Enter') { this.onChat && this.onChat(); }
      if (e.code === 'Tab') { e.preventDefault(); this.onScoreboard && this.onScoreboard(true); }
      if (WEAPON_KEYS[e.key]) this._switch(WEAPON_KEYS[e.key]);
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'Tab') this.onScoreboard && this.onScoreboard(false);
    });
    window.addEventListener('blur', () => { this.keys = {}; this.fire = false; this.alt = false; });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mx += e.movementX;
      this.my += e.movementY;
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.alt = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.alt = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      const order = ['ak47', 'awp', 'deagle', 'knife'];
      const cur = this.currentWeapon || 'ak47';
      let i = order.indexOf(cur);
      i = (i + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length;
      this._switch(order[i]);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.fire = false; this.alt = false; this.mx = 0; this.my = 0; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  _switch(name) {
    if (this.weaponQueued === name) return;
    this.weaponQueued = name;
    this.currentWeapon = name;
    if (this.onWeapon) this.onWeapon(name);
  }

  requestLock() {
    const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }

  // Consome o estado de entrada e devolve a mensagem para o servidor
  poll() {
    const k =
      (this.keys['KeyW'] ? 1 : 0) | (this.keys['KeyS'] ? 2 : 0) |
      (this.keys['KeyA'] ? 4 : 0) | (this.keys['KeyD'] ? 8 : 0) |
      (this.keys['Space'] ? 16 : 0);

    const out = { k, mx: this.mx, my: this.my, fire: this.fire ? 1 : 0, alt: this.alt ? 1 : 0 };
    this.mx = 0; this.my = 0;

    if (this.reloadPending) {
      out.reload = true;
      if (--this.reloadHold <= 0) this.reloadPending = false;
    }
    if (this.weaponQueued) {
      out.weapon = this.weaponQueued;
      this.weaponQueued = null;
    }
    return out;
  }
}
