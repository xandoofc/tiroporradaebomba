// ============================================================
// Craft Strike — Armas (AK-47, AWP, Desert Eagle, Faca)
// ============================================================

export const WEAPONS = {
  ak47: {
    name: 'AK-47',
    kind: 'rifle',
    auto: true,
    dmg: 24,              // dano por tiro no corpo
    hsMult: 2,            // multiplicador de headshot
    mag: 30,
    reserve: 90,
    fireMs: 100,          // 600 RPM
    reloadMs: 2300,
    spreadBase: 0.004,    // rad (precisão parada)
    spreadPerShot: 0.0014,
    spreadMax: 0.055,
    recoilPitch: 0.014,   // soco visual (rad)
    moveMult: 1.0,        // multiplicador de velocidade
  },
  awp: {
    name: 'AWP',
    kind: 'sniper',
    auto: false,
    dmg: 100,             // 1 tiro = kill
    hsMult: 2,
    mag: 5,
    reserve: 15,
    fireMs: 1500,         // ferrolho
    reloadMs: 3500,
    spreadBase: 0.0006,   // precisa em pé parado
    spreadPerShot: 0.0,
    spreadMax: 0.02,
    recoilPitch: 0.06,
    moveMult: 0.85,
    scope: true,          // zoom com botão direito
    scopeFov: 22,
  },
  deagle: {
    name: 'Desert Eagle',
    kind: 'pistol',
    auto: false,
    dmg: 50,
    hsMult: 2,
    mag: 7,
    reserve: 35,
    fireMs: 420,
    reloadMs: 2000,
    spreadBase: 0.012,
    spreadPerShot: 0.004,
    spreadMax: 0.05,
    recoilPitch: 0.03,
    moveMult: 1.0,
  },
  knife: {
    name: 'Faca',
    kind: 'melee',
    auto: false,
    dmg: 55,              // golpe normal (atk)
    altDmg: 85,           // golpe pesado (atk alternativo)
    range: 3.2,           // m
    altRange: 3.6,
    coneDot: 0.5,         // cos(60°) cone do golpe
    fireMs: 600,
    altMs: 1100,
    moveMult: 1.08,
  },
};

export const WEAPON_ORDER = ['ak47', 'awp', 'deagle', 'knife'];
export const WEAPON_KEYS = { '1': 'ak47', '2': 'awp', '3': 'deagle', '4': 'knife' };

export function weaponIndex(name) {
  return WEAPON_ORDER.indexOf(name);
}

export function baseSpeed(weaponName) {
  return (WEAPONS[weaponName]?.moveMult ?? 1.0) * 6.8;
}

// Spread atual levando em conta tiros consecutivos (usado p/ crosshair + servidor)
export function currentSpread(weapon, shotsFired, moving) {
  if (weapon.kind === 'melee') return 0;
  let s = weapon.spreadBase + shotsFired * weapon.spreadPerShot;
  if (moving) s += weapon.kind === 'rifle' ? 0.008 : 0.006;
  if (weapon.kind === 'sniper') s *= 0.5; // parado fica preciso
  return Math.min(s, weapon.spreadMax);
}
