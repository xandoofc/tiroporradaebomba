// ============================================================
// Craft Strike — Renderização (Three.js)
// Câmera em primeira pessoa, viewmodel animado, remotos
// interpolados, partículas e tracers com pool (FPS alto).
// ============================================================

import * as THREE from 'three';
import { buildWorld, buildPlayerModel, buildWeaponModel, makeMuzzleTexture } from './models.js';
import { PLAYER } from '../../shared/constants.js';

const VIEW_POS = {
  ak47:   { pos: [0.3, -0.29, -0.5], rot: [0.02, 0.02, 0] },
  awp:    { pos: [0.24, -0.34, -0.55], rot: [0, 0, 0.03] },
  deagle: { pos: [0.26, -0.27, -0.48], rot: [0.03, 0.03, -0.02] },
  knife:  { pos: [0.3, -0.25, -0.44], rot: [0.12, 0.08, -0.06] },
};

export class GameView {
  constructor(canvas) {
    this.canvas = canvas;
    this.remotes = new Map();     // id -> {model, last, hp, alive, nameEl, hpEl}
    this.corpses = [];
    this.time = 0;
    this.scoped = false;
    this.selfFiring = 0;          // kick de recuo (decai)
    this.viewAnim = null;         // animação atual do viewmodel {type, t, dur}
    this.bobPhase = 0;

    this._initRenderer();
    this._initScene();
    this._initViewModels();
  }

  _initRenderer() {
    // VSync OFF: cria o contexto WebGL com desynchronized (o frame é
    // apresentado sem esperar o refresh do monitor → menor latência).
    const attrs = { antialias: true, powerPreference: 'high-performance', desynchronized: true };
    let context = null;
    try {
      context = this.canvas.getContext('webgl2', attrs) || this.canvas.getContext('webgl', attrs);
    } catch {}
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc3ee);
    this.scene.fog = new THREE.Fog(0x9cc8ee, 80, 200);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x6a7a52, 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3d0, 1.9);
    sun.position.set(35, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -46; sun.shadow.camera.right = 46;
    sun.shadow.camera.top = 46; sun.shadow.camera.bottom = -46;
    sun.shadow.camera.near = 5; sun.shadow.camera.far = 140;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    const { world, clouds } = buildWorld();
    this.world = world;
    this.clouds = clouds;
    this.scene.add(world);

    // pools de efeitos
    this.tracers = [];
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const line = new THREE.Line(geo, tracerMat.clone());
      line.visible = false;
      line.userData.life = 0;
      this.scene.add(line);
      this.tracers.push(line);
    }

    // flash de cano dos OUTROS jogadores (mundial, visível por todos)
    this.remoteFlashes = [];
    const flashTex = makeMuzzleTexture();
    for (let i = 0; i < 12; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTex, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true,
      }));
      sp.visible = false;
      sp.userData.life = 0;
      this.scene.add(sp);
      this.remoteFlashes.push(sp);
    }

    // partículas (sangue + faísca)
    this.particles = [];
    const pGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    const pMatBlood = new THREE.MeshBasicMaterial({ color: 0xc32032 });
    const pMatSpark = new THREE.MeshBasicMaterial({ color: 0xd8c8a0 });
    for (let i = 0; i < 240; i++) {
      const m = new THREE.Mesh(pGeo, i % 3 === 0 ? pMatSpark : pMatBlood);
      m.visible = false;
      m.userData = { life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() };
      this.scene.add(m);
      this.particles.push(m);
    }
    this._partIdx = 0;
  }

  _initViewModels() {
    this.viewGroup = new THREE.Group();
    this.viewWeapons = {};
    for (const kind of ['ak47', 'awp', 'deagle', 'knife']) {
      const w = buildWeaponModel(kind);
      w.visible = false;
      this.viewGroup.add(w);
      this.viewWeapons[kind] = w;
    }
    this.camera.add(this.viewGroup);
    this.viewGroup.position.set(0, 0, -0.2);
    this.currentView = null;
  }

  // ---------------- interface ----------------

  addRemote(id, color, skinIdx) {
    const model = buildPlayerModel(color, skinIdx);
    this.scene.add(model);
    const r = { model, hp: 100, alive: true, walking: 0, lastPos: new THREE.Vector3() };
    this.remotes.set(id, r);
    return r;
  }

  removeRemote(id) {
    const r = this.remotes.get(id);
    if (r) { this.scene.remove(r.model); this.remotes.delete(id); }
  }

  setRemote(id, x, y, z, yaw, pitch, hp, alive, walking) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.model.visible = alive;
    r.model.position.set(x, y, z);
    r.model.rotation.y = yaw;
    r.model.setPitch(pitch);
    r.hp = hp; r.alive = alive;
    const move = walking ? 1 : 0;
    r.model.userData.walkPhase += move * 0.14;
    r.model.setWalk(r.model.userData.walkPhase, move);
    r.lastPos.set(x, y, z);
  }

  killCorpse(id, x, y, z, yaw) {
    const r = this.remotes.get(id);
    if (!r) return;
    // clona o modelo deitado com materiais próprios (para o fade)
    const corpse = r.model.clone();
    corpse.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
    corpse.rotation.set(-Math.PI / 2, yaw, 0);
    corpse.position.set(x, y, z);
    this.scene.add(corpse);
    this.corpses.push({ mesh: corpse, life: 5, t: 0 });
  }

  setSelf({ x, y, z, yaw, pitch, weapon, moving, walkPhase, scoped }) {
    this.self = { x, y, z, yaw, pitch, weapon, moving, walkPhase, scoped };
    this.scoped = scoped;
    this._bobPhase = walkPhase;
  }

  fireVisual() {
    this.selfFiring = 1; // só o recuo visual da arma
  }

  // flash de fogo na posição do cano de outro jogador
  remoteMuzzle(x, y, z) {
    for (const sp of this.remoteFlashes) {
      if (sp.visible) continue;
      sp.position.set(x, y, z);
      const sc = 0.32 + Math.random() * 0.28;
      sp.scale.set(sc, sc, 1);
      sp.material.rotation = Math.random() * Math.PI;
      sp.material.opacity = 1;
      sp.userData.life = 0.05;
      sp.visible = true;
      return;
    }
  }

  setViewAnim(type, dur) { this.viewAnim = { type, t: 0, dur }; }

  addShot(from, to) {
    for (const line of this.tracers) {
      if (line.visible) continue;
      const arr = line.geometry.attributes.position.array;
      arr[0] = from.x; arr[1] = from.y; arr[2] = from.z;
      arr[3] = to.x; arr[4] = to.y; arr[5] = to.z;
      line.geometry.attributes.position.needsUpdate = true;
      line.visible = true;
      line.userData.life = 0.07;
      return;
    }
  }

  bloodAt(pos) {
    this._burst(pos, 0.95, 14);
  }

  sparkAt(pos) {
    this._burst(pos, 0.55, 8);
  }

  _burst(pos, speed, count) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this._partIdx];
      this._partIdx = (this._partIdx + 1) % this.particles.length;
      p.position.set(pos.x, pos.y, pos.z);
      p.userData.vel.set((Math.random() - 0.5) * speed * 2, Math.random() * speed * 1.4 + 0.5, (Math.random() - 0.5) * speed * 2);
      p.userData.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      p.userData.life = 0.45 + Math.random() * 0.35;
      p.visible = true;
    }
  }

  // ---------------- update por frame ----------------

  update(dt) {
    this.time += dt;
    const s = this.self;
    if (!s) return;

    // nuvens
    for (const c of this.clouds) {
      c.position.x = c.userData.baseX + Math.sin(this.time * c.userData.speed) * 6;
    }

    // câmera (com bob de caminhada e mira)
    const bobY = Math.sin(this._bobPhase * 2) * 0.045 * Math.min(s.moving, 1);
    this.camera.position.set(s.x, s.y + PLAYER.eye + bobY, s.z);
    this.camera.rotation.y = s.yaw;
    this.camera.rotation.x = s.pitch;

    // zoom da AWP
    const targetFov = s.scoped && s.weapon === 'awp' ? 24 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 14);
      this.camera.updateProjectionMatrix();
    }

    this._updateViewModel(dt, s);
    this._updateEffects(dt);
    this._updateCorpses(dt);
  }

  _updateViewModel(dt, s) {
    const vp = VIEW_POS[s.weapon] || VIEW_POS.ak47;
    const wm = this.viewWeapons[s.weapon];
    if (!wm) return;

    // troca de arma visível
    for (const k in this.viewWeapons) this.viewWeapons[k].visible = (k === s.weapon);
    this.currentView = wm;

    const base = new THREE.Vector3(...vp.pos);
    const rot = new THREE.Vector3(...vp.rot);

    // animações (reload / switch)
    let animOffset = new THREE.Vector3();
    let animRot = new THREE.Vector3();
    if (this.viewAnim) {
      this.viewAnim.t += dt;
      const pr = Math.min(1, this.viewAnim.t / this.viewAnim.dur);
      if (this.viewAnim.type === 'reload') {
        const up = Math.sin(pr * Math.PI);
        animOffset.set(0, -up * 0.22, up * 0.12);
        animRot.set(-up * 1.25, 0, up * 0.15);
      } else if (this.viewAnim.type === 'switch') {
        const e = 1 - Math.pow(1 - pr, 3);
        animOffset.set((1 - e) * 0.7, -e * 0.05, 0);
        animRot.set(-e * 0.3, 0, (1 - e) * 0.4);
      } else if (this.viewAnim.type === 'knife') {
        const up = Math.sin(pr * Math.PI);
        animOffset.set(0, up * 0.1, -up * 0.35);
        animRot.set(-up * 1.6, 0, up * 0.4);
      }
      if (this.viewAnim.t >= this.viewAnim.dur) this.viewAnim = null;
    }

    // sway + bob + recuo
    const swayX = Math.sin(this.time * 1.3) * 0.006;
    const swayY = Math.cos(this.time * 1.7) * 0.004;
    const bobX = Math.sin(this._bobPhase * 2) * 0.008 * Math.min(s.moving, 1);
    const bobY = Math.abs(Math.cos(this._bobPhase)) * 0.01 * Math.min(s.moving, 1);
    const kick = this.selfFiring;
    const kickX = kick * 0.045;
    const kickRot = kick * 0.14;

    wm.position.copy(base).add(animOffset);
    wm.position.x += swayX + bobX;
    wm.position.y += swayY - bobY + kickX * 0.4;
    wm.position.z += kickX;
    wm.rotation.set(rot.x + animRot.x, rot.y + animRot.y + kick * 0.02, rot.z + animRot.z);
    wm.rotation.x -= kickRot;

    if (s.scoped && s.weapon === 'awp') {
      wm.position.y -= 0.05;
      wm.position.x += 0.06;
    }

    // (sem fogo no próprio FOV — o flash do próprio tiro foi removido)
  }

  _updateEffects(dt) {
    // tracers
    for (const line of this.tracers) {
      if (!line.visible) continue;
      line.userData.life -= dt;
      if (line.userData.life <= 0) { line.visible = false; continue; }
      line.material.opacity = line.userData.life / 0.07;
    }
    // partículas
    for (const p of this.particles) {
      if (!p.visible) continue;
      p.userData.life -= dt;
      if (p.userData.life <= 0) { p.visible = false; continue; }
      p.userData.vel.y -= 9.8 * dt;
      p.position.addScaledVector(p.userData.vel, dt);
      p.rotation.x += p.userData.spin.x * dt;
      p.rotation.y += p.userData.spin.y * dt;
      p.rotation.z += p.userData.spin.z * dt;
      if (p.position.y < 0.05) { p.position.y = 0.05; p.userData.vel.y *= -0.35; }
      p.material.opacity = Math.min(1, p.userData.life / 0.25);
    }
    // flashes remotos
    for (const sp of this.remoteFlashes) {
      if (!sp.visible) continue;
      sp.userData.life -= dt;
      if (sp.userData.life <= 0) { sp.visible = false; continue; }
      sp.material.opacity = Math.max(0, sp.userData.life / 0.05);
    }
    this.selfFiring = Math.max(0, this.selfFiring - dt * 9);
  }

  _updateCorpses(dt) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.t += dt;
      if (c.t > 0.4) c.mesh.traverse((o) => {
        if (o.isMesh) { o.material.transparent = true; o.material.opacity = Math.max(0, 1 - (c.t - 0.4) / 4); }
      });
      if (c.t >= c.life) { this.scene.remove(c.mesh); this.corpses.splice(i, 1); }
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // projeta um ponto 3D para a tela (para nametags) — sem alocar
  project(x, y, z) {
    this._projScratch ||= new THREE.Vector3();
    const v = this._projScratch.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      depth: v.z,
    };
  }

  // esconde todos os nametags (quando o jogador sai)
  clearRemotes() {
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
  }


}
