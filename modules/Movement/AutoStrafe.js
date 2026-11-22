(() => {
  'use strict';

  const CHANNEL = 'solstice-movement';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 80;
  const HEARTBEAT_MS = 400;

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

  function setting(module, name, fallback) {
    const entry = module?.settings.find((item) => item.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig() {
    const module = getMod('AutoStrafe');

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
      module: 'autostrafe',
      enabled: Boolean(module.on),
      strength: Math.max(0.2, Math.min(1.0, Number(setting(module, 'Strength', 0.85)) || 0.85)),
      airOnly: Boolean(setting(module, 'Air Only', true))
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
    name: 'AutoStrafe',
    desc: 'Optimizes air-strafe input angle to preserve server horizontal speed during turns.',
    cat: 'Movement',
    nm: { l: 'autostrafe', ls: 'auto strafe', n: 'AutoStrafe', ns: 'Auto Strafe' },
    disp: 'Strength',
    settings: [
      { t: 'n', n: 'Strength', d: 'How tightly input steers toward optimal tangential acceleration.', v: 0.85, min: 0.2, max: 1.0, step: 0.05 },
      { t: 'b', n: 'Air Only', d: 'Only steer while airborne so ground movement stays sharp.', v: 1 }
    ],
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
    let strength = 0.85;
    let airOnly = true;
    let enginePatched = false;

    const serverVel = {
      vx: 0,
      vz: 0,
      speed: 0,
      ground: true,
      sliding: false
    };

    function patchNetInput(engine) {
      const net = engine?.net;

      if (!net || typeof net.input !== 'function' || net.input.__solsticeAutoStrafePatched) {
        return;
      }

      const originalInput = net.input;
      const wrappedInput = function wrappedAutoStrafeInput(input, ...rest) {
        if (
          enabled &&
          input &&
          !serverVel.sliding &&
          (!airOnly || !serverVel.ground) &&
          serverVel.speed > 2.0
        ) {
          const f = Number(input.forward) || 0;
          const r = Number(input.right) || 0;
          const mag = Math.hypot(f, r);

          if (mag > 0.05) {
            const sy = Math.sin(input.yaw);
            const cy = Math.cos(input.yaw);
            const wishX = -sy * f + cy * r;
            const wishZ = -cy * f - sy * r;
            const wishYaw = Math.atan2(-wishX, -wishZ);
            const velYaw = Math.atan2(-serverVel.vx, -serverVel.vz);
            const diff = bridge.wrapAngle(wishYaw - velYaw);

            // Clamp turn delta so server's 36*STEP accel pulls tangentially instead of braking
            const maxStep = 0.35 + (1 - strength) * 0.45;

            if (Math.abs(diff) > maxStep && Math.abs(diff) < Math.PI * 0.85) {
              const steerYaw = velYaw + Math.sign(diff) * maxStep;
              const rel = steerYaw - input.yaw;
              const scale = Math.min(1, mag);
              input = {
                ...input,
                forward: Math.cos(rel) * scale,
                right: -Math.sin(rel) * scale
              };
            }
          }
        }

        return originalInput.call(this, input, ...rest);
      };

      Object.defineProperty(wrappedInput, '__solsticeAutoStrafePatched', { value: true });
      net.input = wrappedInput;
    }

    function installEnginePatch() {
      if (enginePatched) {
        return;
      }

      enginePatched = true;
      const engineUrl = new URL('client/engine.js', location.href).href;

      import(engineUrl)
        .then(({ Engine }) => {
          const proto = Engine?.prototype;

          if (!proto || typeof proto.snapshot !== 'function' || proto.snapshot.__solsticeAutoStrafePatched) {
            return;
          }

          const originalSnapshot = proto.snapshot;
          const wrappedSnapshot = function wrappedAutoStrafeSnapshot(s, ...rest) {
            patchNetInput(this);
            const me = s?.players?.find((p) => p.id === this.net?.id);

            if (me) {
              serverVel.vx = Number(me.vx) || 0;
              serverVel.vz = Number(me.vz) || 0;
              serverVel.speed = Math.hypot(serverVel.vx, serverVel.vz);
              serverVel.ground = Boolean(me.ground);
              serverVel.sliding = Boolean(me.sliding);
            }

            return originalSnapshot.call(this, s, ...rest);
          };

          Object.defineProperty(wrappedSnapshot, '__solsticeAutoStrafePatched', { value: true });
          proto.snapshot = wrappedSnapshot;
        })
        .catch(() => {
          enginePatched = false;
        });
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'autostrafe') {
        return;
      }

      enabled = Boolean(data.enabled);
      strength = Math.max(0.2, Math.min(1.0, Number(data.strength) || 0.85));
      airOnly = data.airOnly !== false;

      if (enabled) {
        installEnginePatch();
      }
    });
  }
})();
