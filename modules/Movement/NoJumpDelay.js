

(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-movement';
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
    const module = getMod('NoJumpDelay');

    if (!module) {
      return;
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'nojumpdelay',
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
    name: 'NoJumpDelay',
    desc: 'Removes the delay between jumps',
    cat: "Movement",
    nm: { l: 'nojumpdelay', ls: 'no jump delay', n: 'NoJumpDelay', ns: 'No Jump Delay' },
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
    let managed = false;
    let pressed = false;

    function restore() {
      if (!managed) {
        return;
      }

      managed = false;
      pressed = false;

      if (bridge.physicalSpace) {
        bridge.getGH()?.debug?.input?.keys?.add('Space');
      }
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'nojumpdelay') {
        return;
      }

      enabled = Boolean(data.enabled);

      if (!enabled) {
        restore();
      }
    });

    bridge.onWorldMove((context) => {
      if (!enabled || !context?.input) {
        return;
      }

      const input = context.input;
      const buttons = Number(input.buttons) || 0;

      if (!(buttons & 1)) {
        return;
      }

      if (!context.motion?.ground || context.motion?.jumpHeld) {
        input.buttons = buttons & ~1;
        context.localInput = input;
      }
    }, 15);

    bridge.onBeforePlayerUpdate(() => {
      if (!enabled) {
        restore();
        return;
      }

      const context = bridge.getContext();

      if (!context) {
        restore();
        return;
      }

      const { player, input } = context;

      if (!bridge.physicalSpace) {
        managed = false;
        pressed = false;
        return;
      }

      const online = document.body.classList.contains('online-session');

      if (!player.e?.onGround) {
        input.keys?.delete('Space');
        input.down?.delete('Space');
        input.touchDown?.delete('Space');
        managed = true;
        pressed = false;
        return;
      }

      if (pressed) {
        input.keys?.delete('Space');
        input.down?.delete('Space');
        pressed = false;
        managed = true;
        return;
      }

      if (online && bridge.latestOnlineJumpHeld) {
        input.keys?.delete('Space');
        input.down?.delete('Space');
        managed = true;
        return;
      }

      input.keys?.add('Space');
      input.down?.add('Space');
      pressed = true;
      managed = true;
    }, 10);

    bridge.onReset(restore);
  }
})();
