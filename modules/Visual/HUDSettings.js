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

/* 设置项查找缓存：每帧上千次调用也只是一次 Map 命中 */
let iSetAt = -1e9;
let iSetMap = null;
function iSet(n) {
  if (!iSetMap || NOW_MS - iSetAt > 400) {
    const im = BY_NAME['HUDSettings'];
    iSetMap = new Map();
    if (im) for (const s of im.settings) iSetMap.set(s.n, s);
    iSetAt = NOW_MS;
  }
  return iSetMap.get(n);
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
function computeThemed(index) {
  const th = themeName();
  const cols = th === 'Custom' ? customColors() : THEMES[th] || THEMES.Sunset;
  if (!cols.length) return [255, 255, 255];
  const time = 10000 / colorSpeed();
  const modTime = Math.max(1, Math.floor(time));
  const rawIdx = Math.floor(Number(NOW_MS) || 0) + Math.floor(Number(index) || 0);
  const angle = ((rawIdx % modTime) + modTime) % modTime;
  const seg = time / cols.length;
  const si = Math.max(0, Math.floor(angle / seg));
  const f = Math.max(0, Math.min(1, angle / seg - si));
  return lerpC(cols[si % cols.length], cols[(si + 1) % cols.length], f);
}
/* 同一帧内同一个 index 只算一次（Arraylist 每行、Watermark 每字都会问） */
function themed(index) {
  const perf = window.SolsticePerf;
  return perf ? perf.theme(index, computeThemed) : computeThemed(index);
}
const GOOGLE_FONT_OFFICIAL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap';
const GOOGLE_FONT_CN_MIRROR = 'https://fonts.loli.net/css2?family=Inter:wght@400;600;700&display=swap';
const GOOGLE_FONT_CN_FALLBACK = 'https://fonts.lug.ustc.edu.cn/css2?family=Inter:wght@400;600;700&display=swap';
let lastGoogleFontHref = '';

function googleFontSourceUrl() {
  const src = iSet('Font Source');
  const label = src ? src.vals[src.v] : 'China Mirror';
  return label === 'Official' ? GOOGLE_FONT_OFFICIAL : GOOGLE_FONT_CN_MIRROR;
}

function ensureGoogleFont() {
  if (typeof document === 'undefined') {
    return;
  }

  const head = document.head || document.documentElement;

  if (!head) {
    return;
  }

  const targetHref = googleFontSourceUrl();
  let link = document.getElementById('solstice-google-font');

  if (!link) {
    link = document.createElement('link');
    link.id = 'solstice-google-font';
    link.rel = 'stylesheet';
    link.addEventListener('error', () => {
      if (link.href !== GOOGLE_FONT_CN_FALLBACK && targetHref === GOOGLE_FONT_CN_MIRROR) {
        link.href = GOOGLE_FONT_CN_FALLBACK;
        lastGoogleFontHref = GOOGLE_FONT_CN_FALLBACK;
      }
    });
    head.appendChild(link);
  }

  if (lastGoogleFontHref !== targetHref) {
    link.href = targetHref;
    lastGoogleFontHref = targetHref;
  }
}

let uiFontCache = '';
let uiFontAt = -1e9;
function uiFont() {
  if (uiFontCache && NOW_MS - uiFontAt < 500) {
    return uiFontCache;
  }

  const f = iSet('Font');
  const v = f ? f.vals[f.v] || 'Product Sans' : 'Product Sans';
  uiFontAt = NOW_MS;

  if (v === 'Mojangles') {
    uiFontCache = 'Mojangles';
    return uiFontCache;
  }

  if (v === 'Google Font') {
    ensureGoogleFont();
    uiFontCache = 'Inter';
    return uiFontCache;
  }

  uiFontCache = 'Product Sans';
  return uiFontCache;
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

    const fontSetting = module.settings.find((item) => item.n === 'Font');
    const fontSourceSetting = module.settings.find((item) => item.n === 'Font Source');
    if (fontSourceSetting) {
      fontSourceSetting.vis = fontSetting?.vals?.[fontSetting.v] === 'Google Font';
    }

    /* 画质档位（Auto 交给自适应，其余手动锁定） */
    const perf = window.SolsticePerf;
    const qualitySetting = module.settings.find((item) => item.n === 'Quality');
    const qualityIndex = qualitySetting ? Number(qualitySetting.v) || 0 : 0;

    if (perf) {
      perf.setAuto(qualityIndex === 0);
      if (qualityIndex > 0) perf.setLevel([2, 2, 1, 0][qualityIndex] ?? 2);
    }

    const active = Boolean(module.on);
    const maxFps = active ? Math.max(15, Math.min(144, Number(setting(module, 'Max Visual FPS', 60)) || 60)) : 144;
    const overlayFps = active ? Math.max(15, Math.min(144, Number(setting(module, 'Overlay FPS', 60)) || 60)) : 144;
    const maxDpr = active ? Math.max(0.75, Math.min(2, Number(setting(module, 'Max DPR', 1.5)) || 1.5)) : 1.5;
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
      { t: 'e', n: 'Font Source', d: 'CDN source for Google Font (Official or China Mirror).', v: 1, vals: ['Official', 'China Mirror'] },
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
      { t: 'b', n: 'Reduce Blur', d: 'Skip heavy background blur filters while in-game.', v: 1 },
      { t: 'e', n: 'Quality', d: 'Auto scales detail to hold 60 fps; the rest lock a preset.', v: 0, vals: ['Auto', 'High', 'Balanced', 'Low'] }
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
