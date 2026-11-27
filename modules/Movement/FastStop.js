(() => {
  'use strict';

  const CHANNEL = 'solstice-movement';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/potatoepic/')) {
    bootGame();
    return;
  }

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
    const module = getMod('FastStop');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const frame = findGameFrame();

    if (!frame?.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage({
      channel: CHANNEL,
      type: 'config',
      module: 'faststop',
      enabled: Boolean(module.on)
    }, GAME_ORIGIN);
    lastSentAt = now;
  }

  register({
    game: 'potatoepic',
    name: 'FastStop',
    desc: 'Stops movement instantly on key release.',
    cat: 'Movement',
    nm: { l: 'faststop', ls: 'fast stop', n: 'FastStop', ns: 'Fast Stop' },
    disp: '',
    settings: [],
    onRender: syncConfig,
    onEnable() {
      lastSentAt = 0;
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
    let wasMoving = false;

    function moving(game) {
      const keys = game.keys || {};
      const touch = game.touchHeld || {};

      return Boolean(
        keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD ||
        keys.ArrowUp || keys.ArrowLeft || keys.ArrowDown || keys.ArrowRight ||
        touch.forward || touch.back || touch.left || touch.right ||
        touch.potato_forward || touch.potato_back || touch.potato_left || touch.potato_right
      );
    }

    function stop(player) {
      player.vel[0] = 0;
      player.vel[2] = 0;

      if (Array.isArray(player.potV)) {
        player.potV[0] = 0;
        player.potV[1] = 0;
      } else {
        player.potV = [0, 0];
      }

      player.potSlide = null;
      player.potSlideJump = 0;
    }

    bridge.onBeforePlayerUpdate(() => {
      const game = window.game;

      if (!enabled || !game?.player || game.state !== 'play' || game.ui?.screen) {
        wasMoving = false;
        return;
      }

      const current = moving(game);

      if (wasMoving && !current) {
        stop(game.player);
      }

      wasMoving = current;
    }, 5);

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'faststop') {
        return;
      }

      enabled = Boolean(data.enabled);

      if (!enabled) {
        wasMoving = false;
      }
    });
  }
})();
