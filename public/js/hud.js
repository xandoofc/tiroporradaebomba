// ============================================================
// Craft Strike — HUD (DOM)
// ============================================================

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.menu = $('menu');
    this.hud = $('hud');
    this.crosshair = $('crosshair');
    this.healthFill = $('health-fill');
    this.hpVal = $('hp-val');
    this.ammoMag = $('ammo-mag');
    this.ammoRes = $('ammo-res');
    this.weaponName = $('weapon-name');
    this.slots = $('weapon-slots');
    this.killfeed = $('killfeed');
    this.scoreboard = $('scoreboard');
    this.sbBody = $('sb-body');
    this.chatLog = $('chat-log');
    this.chatInput = $('chat-input');
    this.deathScreen = $('death-screen');
    this.deathBy = $('death-by');
    this.deathTimer = $('death-timer');
    this.respawnNow = $('respawn-now');
    this.banner = $('banner');
    this.bannerTitle = $('banner-title');
    this.bannerSub = $('banner-sub');
    this.damage = $('damage-vignette');
    this.hitmarker = $('hitmarker');
    this.scope = $('scope-overlay');
    this.pingEl = $('ping');
    this.fpsEl = $('fps');
    this.kdEl = $('kills-deaths');
    this.streakChip = $('streak-chip');
    this.leaderEl = $('leader');
    this.conn = $('conn-overlay');
    this.connMsg = $('conn-msg');
    this.clickHint = $('click-hint');
    this.namesLayer = $('names-layer');
    this.weaponLabels = { ak47: 'AK-47', awp: 'AWP', deagle: 'DESERT EAGLE', knife: 'FACA' };
    this._bannerTimer = null;
    this._deathTimerInt = null;
  }

  // ---------- estado básico ----------

  setHealth(hp) {
    const pct = Math.max(0, Math.min(100, hp));
    this.healthFill.style.width = pct + '%';
    this.hpVal.textContent = Math.max(0, Math.round(pct));
    this.healthFill.classList.toggle('low', pct <= 30);
  }

  setAmmo(mag, res, weapon, reloading) {
    this.ammoMag.textContent = reloading ? '—' : mag;
    this.ammoRes.textContent = res;
    this.ammoMag.classList.toggle('low', !reloading && mag <= 5 && weapon !== 'knife');
    this.weaponName.textContent = this.weaponLabels[weapon] || weapon.toUpperCase();
  }

  setWeaponSlot(weapon) {
    for (const s of this.slots.children) s.classList.toggle('cur', s.dataset.w === weapon);
  }

  setKD(kills, deaths) {
    this.kdEl.innerHTML = `<b>${kills}</b> ABATES · <b>${deaths}</b> MORTES`;
  }

  setStreak(n) {
    if (n >= 2) {
      this.streakChip.textContent = `${n} ABATES SEGUIDOS`;
      this.streakChip.classList.remove('hidden');
    } else {
      this.streakChip.classList.add('hidden');
    }
  }

  setLeader(name, score) {
    if (name && score > 0) this.leaderEl.textContent = `★ LÍDER: ${name} — ${score} abates`;
    else this.leaderEl.textContent = '';
  }

  setPing(ms) { this.pingEl.innerHTML = `PING <b>${ms}</b>`; }
  setFps(fps) { this.fpsEl.innerHTML = `FPS <b>${fps}</b>`; }

  // ---------- efeitos ----------

  hitmarker() {
    this.hitmarker.classList.remove('show');
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('show');
  }

  damageFlash() {
    this.damage.classList.remove('show');
    void this.damage.offsetWidth;
    this.damage.classList.add('show');
    setTimeout(() => this.damage.classList.remove('show'), 320);
  }

  scope(on) { this.scope.classList.toggle('hidden', !on); this.crosshair.classList.toggle('hidden', on); }

  // ---------- kill feed ----------

  killfeedAdd(killerName, killerColor, weapon, victimName, hs) {
    while (this.killfeed.children.length >= 6) this.killfeed.removeChild(this.killfeed.firstChild);
    const item = document.createElement('div');
    item.className = 'kf-item';
    const wLabel = this.weaponLabels[weapon] || (weapon || '').toUpperCase();
    item.innerHTML =
      `<span class="kf-killer" style="color:${killerColor || '#fff'}">${esc(killerName || '??')}</span>` +
      `<span class="kf-k">»</span><span class="kf-weapon">${esc(wLabel)}</span>` +
      (hs ? '<span class="kf-head">HEADSHOT</span>' : '') +
      `<span class="kf-k">✕</span><span class="kf-victim">${esc(victimName)}</span>`;
    this.killfeed.appendChild(item);
    setTimeout(() => item.classList.add('kf-fade'), 3500);
    setTimeout(() => item.remove(), 4000);
  }

  // ---------- placar ----------

  scoreboardShow() { this.scoreboard.classList.remove('hidden'); }
  scoreboardHide() { this.scoreboard.classList.add('hidden'); }

  scoreboardRender(players, selfId, pings) {
    const sorted = [...players].sort((a, b) => b.score - a.score || a.deaths - b.deaths);
    this.sbBody.innerHTML = '';
    sorted.forEach((p, i) => {
      const tr = document.createElement('tr');
      if (p.id === selfId) tr.className = 'me';
      const kd = p.deaths > 0 ? (p.score / p.deaths).toFixed(2) : p.score.toFixed(2);
      tr.innerHTML =
        `<td>${i + 1}</td>` +
        `<td class="name" style="color:${p.color}">${esc(p.name)}${p.id === selfId ? ' (você)' : ''}</td>` +
        `<td class="num">${p.score}</td><td class="num">${p.deaths}</td>` +
        `<td class="num kd">${kd}</td><td class="num">${pings.get(p.id) ?? '—'}</td>`;
      this.sbBody.appendChild(tr);
    });
  }

  // ---------- chat ----------

  chatSys(text) {
    const d = document.createElement('div');
    d.className = 'chat-msg sys';
    d.textContent = text;
    this._chatPush(d);
  }

  chatAdd(name, color, text) {
    const d = document.createElement('div');
    d.className = 'chat-msg';
    d.innerHTML = `<b style="color:${color || '#fff'}">${esc(name)}</b> ${esc(text)}`;
    this._chatPush(d);
  }

  _chatPush(el) {
    this.chatLog.appendChild(el);
    while (this.chatLog.children.length > 8) this.chatLog.removeChild(this.chatLog.firstChild);
  }

  // ---------- banner / morte ----------

  bannerShow(title, sub, dur = 2.4) {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub || '';
    this.banner.classList.remove('hidden');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.add('hidden'), dur * 1000);
  }

  deathShow(byName, byColor, weapon, respawnMs) {
    this.deathScreen.classList.remove('hidden');
    const wLabel = this.weaponLabels[weapon] || (weapon || '').toUpperCase() || 'o mapa';
    this.deathBy.innerHTML = byName
      ? `morto por <b style="color:${byColor || '#fff'}">${esc(byName)}</b> com <b>${esc(wLabel)}</b>`
      : `caiu do mapa`;
    this.deathTimer.innerHTML = `Respawn em <b>${(respawnMs / 1000).toFixed(1)}</b>s`;
    this.respawnNow.classList.add('hidden');
    clearInterval(this._deathTimerInt);
    const start = performance.now();
    this._deathTimerInt = setInterval(() => {
      const left = Math.max(0, (respawnMs - (performance.now() - start)) / 1000);
      this.deathTimer.innerHTML = `Respawn em <b>${left.toFixed(1)}</b>s`;
      if (left <= 1.4) this.respawnNow.classList.remove('hidden');
      if (left <= 0) this.deathHide();
    }, 100);
  }

  deathHide() {
    clearInterval(this._deathTimerInt);
    this.deathScreen.classList.add('hidden');
  }

  // ---------- telas ----------

  showGame() { this.menu.classList.add('hidden'); this.hud.classList.remove('hidden'); }
  showMenu() { this.hud.classList.add('hidden'); this.menu.classList.remove('hidden'); }

  connShow(msg) { this.connMsg.textContent = msg || 'Tentando reconectar…'; this.conn.classList.remove('hidden'); }
  connHide() { this.conn.classList.add('hidden'); }

  clickHintShow(show) { this.clickHint.classList.toggle('hidden', !show); }

  setNames(visible) { this.namesLayer.style.display = visible ? 'block' : 'none'; }
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
