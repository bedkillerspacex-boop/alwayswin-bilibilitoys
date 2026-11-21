

(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 100;
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

  function setting(module, name, fallback) {
    const value = module.settings.find((entry) => entry.n === name);
    return value ? value.v : fallback;
  }

  function syncConfig() {
    const module = getMod('TriggerBot');

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
      module: 'triggerbot',
      enabled: Boolean(module.on),
      wallCheck: Boolean(setting(module, 'Wall Check', true))
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
    name: 'TriggerBot',
    desc: 'Automatically fires when an enemy is under the crosshair.',
    cat: "Combat",
    nm: { l: 'triggerbot', ls: 'trigger bot', n: 'TriggerBot', ns: 'Trigger Bot' },
    disp: '',
    settings: [
      { t: 'b', n: 'Wall Check', d: 'Only auto-fire when the target is not behind a wall.', v: 1 }
    ],
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
    let wallCheck = true;

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type !== 'config' || data.module !== 'triggerbot') {
        return;
      }

      enabled = Boolean(data.enabled);
      wallCheck = data.wallCheck !== false;

      if (!enabled) {
        bridge.requestAutoFire('trigger', false);
      }
    });

    bridge.onBeforeArsenalUpdate(() => {
      if (!enabled) {
        bridge.requestAutoFire('trigger', false);
        return;
      }

      const context = bridge.getContext();

      if (!context) {
        bridge.requestAutoFire('trigger', false);
        return;
      }

      const { player, camera, actors } = context;
      const forward = player.pos.clone();
      camera.getWorldDirection(forward);

      const eye = camera.position;
      let bestT = Infinity;

      for (const actor of actors) {
        if (!bridge.isEnemy(actor, player)) {
          continue;
        }

        const raw = typeof bridge.getRawPlayer === 'function' ? bridge.getRawPlayer(actor) : null;

        if (raw && raw.alive === false) {
          continue;
        }

        const height = raw
          ? raw.sliding ? 0.95 : raw.crouch ? 1.2 : 1.8
          : Number(actor.e?.h) > 0.2 ? Number(actor.e.h) : 1.8;
        const x = raw ? raw.x : actor.pos.x;
        const y = raw ? raw.y : actor.pos.y;
        const z = raw ? raw.z : actor.pos.z;
        const t = bridge.rayAabb(
          eye.x, eye.y, eye.z,
          forward.x, forward.y, forward.z,
          x - 0.4, y + 0.05, z - 0.4,
          x + 0.4, y + height, z + 0.4,
          140
        );

        if (t !== null && t < bestT) {
          bestT = t;
        }
      }

      if (bestT === Infinity) {
        bridge.requestAutoFire('trigger', false);
        return;
      }

      if (wallCheck) {
        const hit = {
          x: eye.x + forward.x * bestT,
          y: eye.y + forward.y * bestT,
          z: eye.z + forward.z * bestT
        };

        if (!bridge.worldLineClear(eye, hit)) {
          bridge.requestAutoFire('trigger', false);
          return;
        }
      }

      bridge.requestAutoFire('trigger', true);
    }, 10);
  }
})();
