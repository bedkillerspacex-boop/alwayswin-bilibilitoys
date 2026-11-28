(() => {
  'use strict';

  const CHANNEL = 'solstice-misc';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 400;

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/potatoepic/')) {
    bootGame();
    return;
  }

  let lastSentKey = '';
  let lastSentAt = 0;

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}/toy/potatoepic/`)) {
        return frame;
      }
    }
    return null;
  }

  function syncConfig(force = false) {
    const mod = getMod('KeylessUse');
    if (!mod) return;

    const now = performance.now();
    const payload = {
      channel: CHANNEL,
      type: 'config',
      module: 'keylessuse',
      enabled: Boolean(mod.on)
    };
    const key = JSON.stringify(payload);

    if (!force && key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const frame = findGameFrame();
    if (!frame?.contentWindow) return;

    frame.contentWindow.postMessage(payload, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    game: 'potatoepic',
    name: 'KeylessUse',
    desc: 'Open vault doors and use keycard extractions in xzext without needing or consuming a keycard.',
    cat: 'Misc',
    nm: { l: 'keylessuse', ls: 'keyless use', n: 'KeylessUse', ns: 'Keyless Use' },
    disp: '',
    settings: [],
    onRender: () => syncConfig(false),
    defaultOn: false,
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncConfig(true);
    }
  });

  function bootGame() {
    let attempts = 0;
    function start() {
      const bridge = window.SolsticeGame;
      if (!bridge) {
        if (attempts++ < 120) setTimeout(start, 25);
        return;
      }
      installGame(bridge);
    }
    start();
  }

  function installGame(bridge) {
    let enabled = false;
    const hookedXze = new WeakSet();

    function isKeycardId(xze, itemKey) {
      if (!itemKey || typeof itemKey !== 'string') return false;
      try {
        if (xze.def?.(itemKey)?.cat === 'key') return true;
      } catch {}
      const r = xze.R;
      if (r?.P?.vault?.key && r.P.vault.key === itemKey) return true;
      if (Array.isArray(r?.ext) && r.ext.some((ext) => ext && ext.key === itemKey)) return true;
      return false;
    }

    function installHooks() {
      const xze = window.XZE;
      if (!xze || hookedXze.has(xze)) return;
      if (typeof xze.countIn !== 'function' || typeof xze.takeFrom !== 'function') return;

      hookedXze.add(xze);

      const origCountIn = xze.countIn;
      const wrappedCountIn = function keylessCountIn(loadout, itemKey, ...rest) {
        const real = origCountIn.call(this, loadout, itemKey, ...rest);
        if (enabled && isKeycardId(xze, itemKey)) {
          return Math.max(1, Number(real) || 0);
        }
        return real;
      };
      Object.defineProperty(wrappedCountIn, '__solsticeKeylessCount', { value: true });
      xze.countIn = wrappedCountIn;

      const origTakeFrom = xze.takeFrom;
      const wrappedTakeFrom = function keylessTakeFrom(loadout, itemKey, count, ...rest) {
        if (enabled && isKeycardId(xze, itemKey)) {
          return Math.max(1, Number(count) || 1);
        }
        return origTakeFrom.call(this, loadout, itemKey, count, ...rest);
      };
      Object.defineProperty(wrappedTakeFrom, '__solsticeKeylessTake', { value: true });
      xze.takeFrom = wrappedTakeFrom;
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'keylessuse') return;
      enabled = Boolean(data.enabled);
      installHooks();
    });

    installHooks();
    setInterval(installHooks, 500);
  }
})();
