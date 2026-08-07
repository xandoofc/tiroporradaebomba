// ============================================================
// Craft Strike — Cliente de rede (WebSocket)
// ============================================================

export class Net {
  constructor() {
    this.ws = null;
    this._h = {};
  }

  on(type, cb) {
    (this._h[type] ||= []).push(cb);
  }

  _emit(type, msg) {
    const list = this._h[type];
    if (list) for (const cb of list) cb(msg);
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = () => reject(new Error('Falha ao conectar no WebSocket'));
      this.ws.onclose = () => this._emit('close');
      this.ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!m) return;
        if (m.t) {
          this._emit(m.t, m);
        } else if (m.s) {
          this._emit('state', m);
          for (const e of m.e || []) this._emit('ev:' + e.k, e);
        }
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    try { this.ws && this.ws.close(); } catch {}
  }
}
