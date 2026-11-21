(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;

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
    const module = getMod('CrouchShot');

    if (!module) {
      return;
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'crouchshot',
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
    name: 'CrouchShot',
    desc: 'Crouches before firing and releases after the shot.',
    cat: 'Combat',
    nm: { l: 'crouchshot', ls: 'crouch shot', n: 'CrouchShot', ns: 'Crouch Shot' },
    disp: '',
    settings: [],
    onRender: syncConfig,
    onEnable() {
      syncConfig();
    }
  });

  setInterval(syncConfig, 250);

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
    let owned = false;
    const suppressedShifts = new Set();

    function input() {
      return bridge.getGH()?.debug?.input;
    }

    function firing() {
      const target = input();

      return Boolean(
        bridge.physicalLmb ||
        target?.keys?.has('Mouse0') ||
        target?.down?.has('Mouse0')
      );
    }

    function stopSprint() {
      const target = input();

      if (!target?.keys) {
        return;
      }

      for (const code of ['ShiftLeft', 'ShiftRight']) {
        if (target.keys.has(code)) {
          suppressedShifts.add(code);
          target.keys.delete(code);
          target.down?.delete(code);
        }
      }
    }

    function restoreSprint() {
      const target = input();

      if (target?.keys && suppressedShifts.size) {
        if (suppressedShifts.has('ShiftLeft') && bridge.physicalShiftLeft) {
          target.keys.add('ShiftLeft');
        }

        if (suppressedShifts.has('ShiftRight') && bridge.physicalShiftRight) {
          target.keys.add('ShiftRight');
        }
      }

      suppressedShifts.clear();
    }

    function press() {
      const target = input();

      if (!target?.keys) {
        return;
      }

      if (
        target.keys.has('KeyC') ||
        target.keys.has('ControlLeft') ||
        target.keys.has('ControlRight')
      ) {
        return;
      }

      target.keys.add('KeyC');
      owned = true;
    }

    function release() {
      const target = input();

      if (owned) {
        target?.keys?.delete('KeyC');
      }

      owned = false;
      restoreSprint();
    }

    function update() {
      if (!enabled) {
        release();
        return;
      }

      if (firing()) {
        stopSprint();
        press();
        return;
      }

      release();
    }

    function releaseAfterShot() {
      if (!enabled) {
        return;
      }

      queueMicrotask(release);
    }

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type !== 'config' || data.module !== 'crouchshot') {
        return;
      }

      enabled = Boolean(data.enabled);

      if (!enabled) {
        release();
      }
    });

    bridge.onBeforePlayerUpdate(() => update(), 25);
    bridge.onBeforeArsenalUpdate(() => update(), 25);
    bridge.onCombatFire(() => {
      releaseAfterShot();
      return null;
    }, 25);

    bridge.onReset(release);
  }
})();
