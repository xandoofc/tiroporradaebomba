// ============================================================
// Craft Strike — Áudio sintetizado (WebAudio, sem arquivos)
// ============================================================

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._noise = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  // ruído filtrado
  _noiseBurst(dur, freq, q, gain, type = 'bandpass', slideTo = null, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  _tone(freq, dur, type = 'sine', gain = 0.3, slideTo = null, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // ---------- sons do jogo ----------

  shot(kind, vol = 1) {
    const v = Math.max(0.05, Math.min(1, vol));
    switch (kind) {
      case 'ak47':
        this._noiseBurst(0.05, 2600, 1, 0.55 * v, 'highpass');
        this._noiseBurst(0.11, 900, 0.8, 0.6 * v, 'lowpass');
        this._tone(95, 0.09, 'sine', 0.45 * v, 60);
        break;
      case 'awp':
        this._noiseBurst(0.09, 1400, 1.2, 0.9 * v, 'bandpass');
        this._noiseBurst(0.32, 350, 0.6, 0.85 * v, 'lowpass');
        this._tone(65, 0.28, 'sine', 0.7 * v, 40);
        break;
      case 'deagle':
        this._noiseBurst(0.07, 900, 1.4, 0.8 * v, 'bandpass');
        this._noiseBurst(0.1, 300, 0.6, 0.55 * v, 'lowpass');
        this._tone(120, 0.08, 'sine', 0.5 * v, 70);
        break;
      case 'knife':
        this._noiseBurst(0.14, 900, 1, 0.22 * v, 'bandpass', 250);
        break;
    }
  }

  knifeHit() { this._tone(240, 0.08, 'square', 0.3, 140); this._noiseBurst(0.08, 500, 1, 0.3, 'lowpass'); }
  hit(headshot) { if (headshot) this._tone(1500, 0.07, 'triangle', 0.4); else this._tone(820, 0.06, 'triangle', 0.35, 600); }
  hurt() { this._noiseBurst(0.16, 320, 0.8, 0.5, 'lowpass'); this._tone(160, 0.14, 'sine', 0.4, 110); }
  kill() { this._tone(523, 0.09, 'square', 0.18); this._tone(784, 0.14, 'square', 0.18, null, 0.09); }
  dry() { this._tone(750, 0.03, 'square', 0.2); }
  reload() {
    this._tone(1000, 0.03, 'square', 0.25);
    this._tone(850, 0.03, 'square', 0.25, null, 0.16);
    this._tone(1150, 0.04, 'square', 0.28, null, 0.34);
  }
  reloadEnd() { this._tone(500, 0.05, 'square', 0.2, 700); }
  switchGun() { this._tone(600, 0.04, 'square', 0.15, 900); }
  jump() { this._noiseBurst(0.06, 400, 1, 0.12, 'lowpass'); }
  land() { this._noiseBurst(0.07, 300, 1, 0.16, 'lowpass'); this._tone(170, 0.06, 'sine', 0.18, 120); }
  footstep() { this._noiseBurst(0.05, 240, 1, 0.09, 'lowpass'); }
  streak(n) {
    const notes = [523, 659, 784, 1047];
    for (let i = 0; i < Math.min(n === 10 ? 4 : 3, notes.length); i++) {
      this._tone(notes[i], 0.1, 'triangle', 0.22, null, i * 0.09);
    }
  }
  chat() { this._tone(1250, 0.045, 'sine', 0.12); }
  respawn() { this._tone(440, 0.08, 'sine', 0.2, 660); }
}
