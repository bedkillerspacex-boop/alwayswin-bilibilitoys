

(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && (location.pathname.startsWith('/toy/golden-hour/') || location.pathname.startsWith('/toy/potatoepic/'))) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const gamePrefix = () => (document.documentElement?.getAttribute('data-solstice-game') === 'potatoepic' || location.pathname.includes('/potatoepic/')) ? '/toy/potatoepic/' : '/toy/golden-hour/';
  const MIN_SEND_INTERVAL_MS = 100;
  const HEARTBEAT_MS = 500;

  let lastSentKey = '';
  let lastSentAt = 0;

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}${gamePrefix()}`)) {
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
    const module = getMod('AimBot');

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
      module: 'aimbot',
      enabled: Boolean(module.on),
      smooth: Math.max(1, Math.min(20, Number(setting(module, 'Aim Smooth', 4)))),
      wallCheck: Boolean(setting(module, 'Wall Check', true)),
      rightClick: Boolean(setting(module, 'Right Click', false))
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
    name: 'AimBot',
    desc: 'Smoothly aims at enemy heads.',
    cat: "Combat",
    nm: { l: 'aimbot', ls: 'aim bot', n: 'AimBot', ns: 'Aim Bot' },
    disp: '',
    settings: [
      {
        t: 'n',
        n: 'Aim Smooth',
        d: 'Higher values make the aim smoother and slower.',
        v: 4.0,
        min: 1.0,
        max: 20.0,
        step: 0.1
      },
      { t: 'b', n: 'Wall Check', d: 'Only aim at targets that are not behind walls.', v: 1 },
      { t: 'b', n: 'Right Click', d: 'Only aim while holding the right mouse button.', v: 0 }
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
    let config = {
      enabled: false,
      smooth: 4,
      wallCheck: true,
      rightClick: false
    };

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type !== 'config' || data.module !== 'aimbot') {
        return;
      }

      const smooth = Number(data.smooth);

      config = {
        enabled: Boolean(data.enabled),
        smooth: Number.isFinite(smooth) ? bridge.clamp(smooth, 1, 20) : 4,
        wallCheck: data.wallCheck !== false,
        rightClick: Boolean(data.rightClick)
      };
    });

    bridge.onBeforePlayerUpdate((dt) => {
      if (!config.enabled) {
        return;
      }

      const context = bridge.getContext();

      if (!context) {
        return;
      }

      const { player, camera, input, actors } = context;
      const aura = bridge.getFeature('aura');
      const syntheticAds = Boolean(aura?.isSyntheticAds?.());
      const rightHeld = bridge.physicalRmb || (input.held?.('Mouse2') && !syntheticAds);

      if (config.rightClick && !rightHeld) {
        return;
      }

      const forward = player.pos.clone();
      const head = player.pos.clone();
      const projected = player.pos.clone();
      camera.getWorldDirection(forward);

      const eye = camera.position;
      let best = null;
      let bestScore = Infinity;

      for (const actor of actors) {
        if (!bridge.isEnemy(actor, player)) {
          continue;
        }

        const raw = typeof bridge.getRawPlayer === 'function' ? bridge.getRawPlayer(actor) : null;

        if (raw && raw.alive !== false) {
          const eyeHeight = raw.sliding ? 0.72 : raw.crouch ? 1.0 : 1.62;
          head.set(raw.x, raw.y + eyeHeight, raw.z);
        } else {
          bridge.headPoint(actor, head);
        }

        const dx = head.x - eye.x;
        const dy = head.y - eye.y;
        const dz = head.z - eye.z;

        if (dx * forward.x + dy * forward.y + dz * forward.z <= 0.1) {
          continue;
        }

        projected.copy(head).project(camera);

        if (
          !Number.isFinite(projected.x) ||
          !Number.isFinite(projected.y) ||
          !Number.isFinite(projected.z) ||
          projected.z < -1 ||
          projected.z > 1 ||
          Math.abs(projected.x) > 1.25 ||
          Math.abs(projected.y) > 1.25
        ) {
          continue;
        }

        const score = projected.x * projected.x + projected.y * projected.y;

        if (score < bestScore) {
          bestScore = score;
          best = { x: head.x, y: head.y, z: head.z };
        }
      }

      if (!best) {
        return;
      }

      if (config.wallCheck && !bridge.worldLineClear(eye, best)) {
        return;
      }

      const dx = best.x - eye.x;
      const dy = best.y - eye.y;
      const dz = best.z - eye.z;
      const targetYaw = Math.atan2(-dx, -dz);
      const targetPitch = Math.atan2(dy, Math.hypot(dx, dz));
      const frameDt = Number.isFinite(dt) ? bridge.clamp(dt, 1 / 240, 0.1) : 1 / 60;
      const factor = 1 - Math.exp(-(30 / bridge.clamp(config.smooth, 1, 20)) * frameDt);

      player.yaw += bridge.wrapAngle(targetYaw - player.yaw) * factor;
      player.pitch = bridge.clamp(player.pitch + (targetPitch - player.pitch) * factor, -1.5, 1.5);

      input.mx = 0;
      input.my = 0;
    }, 40);
  }
})();
