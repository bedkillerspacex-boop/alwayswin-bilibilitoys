(() => {
  'use strict';

  const CHANNEL = 'solstice-rawinput';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 150;
  const HEARTBEAT_MS = 1000;

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

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
    const module = getMod('RawInput');

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
    name: 'RawInput',
    desc: 'Requests unadjusted raw mouse movement when locking pointer (disables OS mouse acceleration).',
    cat: 'Misc',
    nm: { l: 'rawinput', ls: 'raw input', n: 'RawInput', ns: 'Raw Input' },
    disp: '',
    settings: [],
    onRender: syncConfig,
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncConfig();
    }
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

    function installPointerLockHook() {
      const proto = typeof Element !== 'undefined' ? Element.prototype : null;

      if (!proto || typeof proto.requestPointerLock !== 'function' || proto.requestPointerLock.__solsticeRawInputPatched) {
        return;
      }

      const originalRequestPointerLock = proto.requestPointerLock;
      const wrappedRequestPointerLock = function wrappedRawInputPointerLock(options, ...rest) {
        if (!enabled) {
          return originalRequestPointerLock.call(this, options, ...rest);
        }

        const nextOptions =
          options && typeof options === 'object'
            ? { ...options, unadjustedMovement: true }
            : { unadjustedMovement: true };

        try {
          const result = originalRequestPointerLock.call(this, nextOptions, ...rest);

          if (result && typeof result.catch === 'function') {
            return result.catch(() => originalRequestPointerLock.call(this, options, ...rest));
          }

          return result;
        } catch {
          return originalRequestPointerLock.call(this, options, ...rest);
        }
      };

      Object.defineProperty(wrappedRequestPointerLock, '__solsticeRawInputPatched', { value: true });
      proto.requestPointerLock = wrappedRequestPointerLock;
    }

    installPointerLockHook();

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }

      enabled = Boolean(data.enabled);
    });
  }
})();
