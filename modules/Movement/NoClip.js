(() => {
  'use strict';

  /* NoClip：只穿水平墙体，不穿地板。
     client/simulation.js 中水平 X/Z 移动调用 World.prototype.blockedAt() 判墙，
     而垂直地面/重力直接遍历 nearby()，因此让 blockedAt 返回 false 即可只穿水平墙。 */

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-movement';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 80;
  const HEARTBEAT_MS = 400;

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

  function syncConfig() {
    const module = getMod('NoClip');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'noclip',
      enabled: Boolean(module.on)
    };
    const key = JSON.stringify(config);

    if (key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const frame = findGameFrame();

    if (!frame?.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage(config, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    name: 'NoClip',
    desc: 'Passes through horizontal walls without falling through floors.',
    cat: 'Movement',
    nm: { l: 'noclip', ls: 'no clip', n: 'NoClip', ns: 'No Clip' },
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
        if (attempts++ < 100) {
          setTimeout(start, 25);
        }

        return;
      }

      installGame(bridge);
    }

    start();
  }

  function installGame(bridge) {
    let enabled = false;
    let simPatched = false;

    function wrapBlockedAt(target) {
      if (!target || typeof target.blockedAt !== 'function' || target.blockedAt.__solsticeNoClipPatched) {
        return;
      }

      const original = target.blockedAt;
      const wrapped = function wrappedNoClipBlockedAt(...args) {
        if (enabled) {
          return false;
        }

        return original.apply(this, args);
      };

      Object.defineProperty(wrapped, '__solsticeNoClipPatched', { value: true });
      target.blockedAt = wrapped;
    }

    function installSimPatch() {
      if (simPatched) {
        return;
      }

      simPatched = true;
      const simUrl = new URL('client/simulation.js', location.href).href;

      import(simUrl)
        .then(({ World }) => {
          wrapBlockedAt(World?.prototype);
        })
        .catch(() => {
          simPatched = false;
        });
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'noclip') {
        return;
      }

      enabled = Boolean(data.enabled);

      if (enabled) {
        installSimPatch();
      }
    });

    bridge.onPlayerUpdate(() => {
      if (enabled) {
        installSimPatch();
        wrapBlockedAt(bridge.getGH()?.debug?.world);
      }
    }, 25);
  }
})();
