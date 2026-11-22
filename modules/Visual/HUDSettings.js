function modName(m) {
  const st = namingStyle();
  const k = ['l', 'ls', 'n', 'ns'][st] || 'ns';
  let v = m.nm[k] || m.nm.ns || m.name;
  if (st <= 1) v = v.toLowerCase();
  return v;
}

const THEMES = {
  Trans: [[91, 206, 250], [245, 169, 184], [255, 255, 255], [245, 169, 184]],
  Bubblegum: [[255, 99, 202], [255, 195, 195], [146, 245, 255], [249, 255, 148], [135, 255, 176]],
  Watermelon: [[255, 70, 70], [139, 0, 0], [144, 238, 144], [34, 139, 34], [204, 255, 204]],
  Sunset: [[213, 32, 0], [239, 118, 39], [255, 154, 86], [255, 255, 255], [209, 98, 164], [181, 86, 144]],
  Poison: [[115, 222, 70], [67, 201, 89], [41, 230, 94], [12, 210, 83], [87, 211, 72], [57, 210, 124]],
  Custom: []
};
const THEME_NAMES = ['Trans', 'Bubblegum', 'Watermelon', 'Sunset', 'Poison', 'Custom'];

function iSet(n) {
  const im = BY_NAME['HUDSettings'];
  return im && im.settings.find((s) => s.n === n);
}

function namingStyle() {
  const s = iSet('Naming');
  return s ? s.v : 3;
}
function themeName() {
  const s = iSet('Theme');
  return s ? THEME_NAMES[s.v] || 'Sunset' : 'Sunset';
}
function colorSpeed() {
  const s = iSet('Color Speed');
  return s ? s.v : 3;
}
function saturation() {
  const s = iSet('Saturation');
  return s ? s.v : 1;
}
function customColors() {
  const im = BY_NAME['HUDSettings'];
  const cnt = (im?.settings.find((s) => s.n === 'Colors') || { v: 3 }).v;
  const out = [];
  for (let i = 1; i <= cnt; i++) {
    const s = im?.settings.find((x) => x.n === 'Color ' + i);
    if (s) out.push(s.v.slice(0, 3));
  }
  return out.length ? out : [[255, 255, 255]];
}
function themed(index) {
  const th = themeName();
  const cols = th === 'Custom' ? customColors() : THEMES[th] || THEMES.Sunset;
  if (!cols.length) return [255, 255, 255];
  const time = 10000 / colorSpeed();
  const angle = (Math.floor(NOW_MS) + Math.floor(index)) % Math.max(1, Math.floor(time));
  const seg = time / cols.length;
  const si = Math.floor(angle / seg);
  const f = angle / seg - si;
  return lerpC(cols[si % cols.length], cols[(si + 1) % cols.length], f);
}
let googleFontInjected = false;

function ensureGoogleFont() {
  if (googleFontInjected || typeof document === 'undefined') {
    return;
  }

  const head = document.head || document.documentElement;

  if (!head || document.getElementById('solstice-google-font')) {
    googleFontInjected = true;
    return;
  }

  googleFontInjected = true;
  const link = document.createElement('link');
  link.id = 'solstice-google-font';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap';
  head.appendChild(link);
}

function uiFont() {
  const f = iSet('Font');
  const v = f ? f.vals[f.v] || 'Product Sans' : 'Product Sans';

  if (v === 'Mojangles') {
    return 'Mojangles';
  }

  if (v === 'Google Font') {
    ensureGoogleFont();
    return 'Inter';
  }

  return 'Product Sans';
}

(() => {
  'use strict';

  const CHANNEL = 'solstice-hud-settings';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 120;
  const HEARTBEAT_MS = 1000;

  let lastSentKey = '';
  let lastSentAt = 0;

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}/toy/golden-hour/`)) {
        return frame;
      }
    }

    return null;
  }

  function setting(module, name, fallback) {
    const entry = module?.settings.find((item) => item.n === name);
    return entry ? entry.v : fallback;
  }

  function syncSettings() {
    const module = getMod('HUDSettings');

    if (!module) {
      return;
    }

    const active = Boolean(module.on);
    const maxFps = active ? Math.max(15, Math.min(144, Number(setting(module, 'Max Visual FPS', 60)) || 60)) : 144;
    const overlayFps = active ? Math.max(15, Math.min(144, Number(setting(module, 'Overlay FPS', 60)) || 60)) : 144;
    const maxDpr = active ? Math.max(0.75, Math.min(2, Number(setting(module, 'Max DPR', 1.5)) || 1.5)) : 2;
    const reduceBlur = active ? Boolean(setting(module, 'Reduce Blur', true)) : false;

    window.SolsticeHudSettings = {
      active,
      maxFps,
      overlayFps,
      maxDpr,
      reduceBlur
    };

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const payload = {
      channel: CHANNEL,
      type: 'config',
      active,
      overlayFps,
      maxDpr
    };
    const key = JSON.stringify(payload);

    if (key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const frame = findGameFrame();

    if (!frame?.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage(payload, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    name: 'HUDSettings',
    desc: 'Customize theme, typography, FPS caps, DPR scaling, and visual performance limits.',
    cat: 'Visual',
    nm: { l: 'hudsettings', ls: 'hud settings', n: 'HUDSettings', ns: 'HUD Settings' },
    disp: 'Max Visual FPS',
    defaultOn: true,
    settings: [
      { t: 'e', n: 'Naming', d: 'The style of the module names.', v: 0, vals: ['lowercase', 'lower spaced', 'Normal', 'Spaced'] },
      { t: 'e', n: 'Theme', d: 'The mode of the interface.', v: 0, vals: ['Trans', 'Bubblegum', 'Watermelon', 'Sunset', 'Poison', 'Custom'] },
      { t: 'e', n: 'Font', d: 'The font of the interface.', v: 0, vals: ['Mojangles', 'Product Sans', 'Google Font'] },
      { t: 'n', n: 'Colors', d: 'The amount of colors in the interface.', v: 3.0, min: 1.0, max: 6.0, step: 1.0 },
      { t: 'c', n: 'Color 1', d: 'The first color of the interface.', v: [255, 0, 0, 255] },
      { t: 'c', n: 'Color 2', d: 'The second color of the interface.', v: [255, 127, 0, 255] },
      { t: 'c', n: 'Color 3', d: 'The third color of the interface.', v: [255, 214, 0, 255] },
      { t: 'c', n: 'Color 4', d: 'The fourth color of the interface.', v: [0, 255, 0, 255] },
      { t: 'c', n: 'Color 5', d: 'The fifth color of the interface.', v: [0, 0, 255, 255] },
      { t: 'c', n: 'Color 6', d: 'The sixth color of the interface.', v: [139, 0, 255, 255] },
      { t: 'n', n: 'Color Speed', d: 'The speed of the color change.', v: 3.0, min: 0.01, max: 20.0, step: 0.01 },
      { t: 'n', n: 'Saturation', d: 'The saturation of the interface.', v: 1.0, min: 0.0, max: 1.0, step: 0.01 },
      { t: 'b', n: 'Slot Easing', d: 'Eases the selection of slots.', v: 1 },
      { t: 'n', n: 'Easing Speed', d: 'The speed of the slot easing.', v: 20.0, min: 0.1, max: 20.0, step: 0.01 },
      { t: 'n', n: 'Max Visual FPS', d: 'Max redraw rate for parent HUD elements when GUI is closed.', v: 60, min: 15, max: 144, step: 5 },
      { t: 'n', n: 'Overlay FPS', d: 'Max redraw rate for in-game ESP, NameTags, and Backtrack overlays.', v: 60, min: 15, max: 144, step: 5 },
      { t: 'n', n: 'Max DPR', d: 'Cap canvas pixel ratio to reduce GPU fill-rate on high-DPI screens.', v: 1.5, min: 0.75, max: 2.0, step: 0.25 },
      { t: 'b', n: 'Reduce Blur', d: 'Skip heavy background blur filters while in-game.', v: 1 }
    ],
    onInit(m) {
      const th = m.settings.find((s) => s.n === 'Theme');
      if (th) th.v = 3;
      const nm = m.settings.find((s) => s.n === 'Naming');
      if (nm) nm.v = 3;
      const ft = m.settings.find((s) => s.n === 'Font');
      if (ft) ft.v = 1;
    },
    onRender: syncSettings,
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncSettings();
    }
  });
})();
