(() => {
  'use strict';

  /* FastStealer：搜打撤不转圈直接拿取容器内物品 */

  const CHANNEL = 'solstice-faststealer';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;

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

  function syncConfig() {
    const mod = typeof getMod === 'function' ? getMod('FastStealer') : null;
    if (!mod) return;

    const now = performance.now();
    const cfg = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(mod.on)
    };
    const key = JSON.stringify(cfg);
    if (key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) return;

    const frame = findGameFrame();
    if (!frame?.contentWindow) return;

    frame.contentWindow.postMessage(cfg, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    game: 'potatoepic',
    name: 'FastStealer',
    desc: 'Skip item reveal spinner and grab loot immediately in xzext.',
    cat: 'Misc',
    nm: { l: 'faststealer', ls: 'fast stealer', n: 'FastStealer', ns: 'Fast Stealer' },
    disp: '',
    settings: [],
    onRender: syncConfig,
    onEnable() {}
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
    let origReveal = null;

    function applyFastSteal() {
      const xze = window.XZE;
      if (!xze) return;

      if (Array.isArray(xze.REVEAL)) {
        if (!origReveal) {
          origReveal = xze.REVEAL.slice();
        }
        if (enabled) {
          for (let i = 0; i < xze.REVEAL.length; i++) {
            xze.REVEAL[i] = 0;
          }
        } else if (origReveal) {
          for (let i = 0; i < origReveal.length; i++) {
            xze.REVEAL[i] = origReveal[i];
          }
        }
      }

      if (!enabled) return;

      const openBox = xze.R?.open?.b;
      if (!openBox) return;

      if (!openBox.opened) {
        openBox.openT = performance.now() - 1e6;
      }

      const items = openBox.g?.items;
      if (Array.isArray(items)) {
        for (const slot of items) {
          if (slot && !slot.seen) {
            slot.seen = true;
          }
        }
      }
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') return;
      enabled = Boolean(data.enabled);
      applyFastSteal();
    });

    setInterval(applyFastSteal, 40);
  }
})();
