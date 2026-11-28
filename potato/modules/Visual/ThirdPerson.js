(() => {
  'use strict';

  const CHANNEL = 'solstice-visual';
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

  function valueOf(module, name, fallback) {
    const setting = module.settings.find((entry) => entry.n === name);
    const value = setting ? setting.v : fallback;
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function syncConfig() {
    const module = getMod('ThirdPerson');
    if (!module) return;

    const modeSetting = module.settings.find((s) => s.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] === 'Front' ? 'Front' : 'Back';

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'thirdperson',
      enabled: Boolean(module.on),
      mode,
      distance: valueOf(module, 'Distance', 4.0),
      height: valueOf(module, 'Height', 0.0),
      wallCheck: Boolean((module.settings.find((s) => s.n === 'Wall Check') || { v: 1 }).v)
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
    game: 'potatoepic',
    name: 'ThirdPerson',
    desc: 'Moves the camera behind or in front of your player in PotatoEpic.',
    cat: 'Visual',
    nm: { l: 'thirdperson', ls: 'third person', n: 'ThirdPerson', ns: 'Third Person' },
    disp: 'Distance',
    settings: [
      { t: 'e', n: 'Mode', d: 'Camera direction relative to your player.', v: 0, vals: ['Back', 'Front'] },
      { t: 'n', n: 'Distance', d: 'How far the camera sits from your player.', v: 4.0, min: 0.5, max: 10.0, step: 0.1 },
      { t: 'n', n: 'Height', d: 'Vertical offset of the camera.', v: 0.0, min: -1.0, max: 2.5, step: 0.05 },
      { t: 'b', n: 'Wall Check', d: 'Prevents the third-person camera from clipping into walls.', v: 1 }
    ],
    renderOrder: 3,
    onRender: syncConfig,
    defaultOn: false,
    onEnable() {
      lastSentAt = 0;
      syncConfig();
    }
  });

  function bootGame() {
    let attempts = 0;

    function start() {
      const bridge = window.SolsticeGame;
      if (!bridge) {
        if (attempts++ < 120) {
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
    let mode = 'Back';
    let distance = 4.0;
    let height = 0.0;
    let wallCheck = true;
    let prevEnabled = false;
    let savedPerspective = 0;

    function realEye(game) {
      const player = game?.player;
      if (!player) return null;
      try {
        const eye = typeof window.XZ?.eyeOf === 'function' ? window.XZ.eyeOf(player) : null;
        if (eye && eye.every(Number.isFinite)) {
          return [eye[0], eye[1], eye[2]];
        }
      } catch {}
      const pos = player.pos;
      if (!pos) return null;
      const eyeH = player.sneaking ? 1.27 : 1.62;
      return [
        Number(pos[0]) || 0,
        (Number(pos[1]) || 0) + eyeH,
        Number(pos[2]) || 0
      ];
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'thirdperson') {
        return;
      }
      enabled = Boolean(data.enabled);
      mode = data.mode === 'Front' ? 'Front' : 'Back';
      distance = bridge.clamp(Number(data.distance) || 4.0, 0.5, 10.0);
      height = bridge.clamp(Number(data.height) || 0.0, -1.0, 2.5);
      wallCheck = data.wallCheck !== false;

      const game = window.game;
      if (game) {
        if (enabled && !prevEnabled) {
          savedPerspective = Number(game.perspective) || 0;
        } else if (!enabled && prevEnabled) {
          game.perspective = savedPerspective === 0 ? 0 : savedPerspective;
        }
      }
      prevEnabled = enabled;
    });

    if (typeof bridge.provide === 'function') {
      bridge.provide('thirdperson', {
        getEye() {
          const e = realEye(window.game);
          return e ? { x: e[0], y: e[1], z: e[2] } : null;
        }
      });
    }

    bridge.onBeforePlayerUpdate(() => {
      const game = window.game;
      if (!game) return;
      if (enabled) {
        game.perspective = mode === 'Front' ? 2 : 1;
      }
    });

    function installHooks() {
      const game = window.game;
      const renderer = game?.renderer;
      if (!game || !renderer) return;

      if (typeof renderer.setCamera === 'function' && !renderer.setCamera.__solsticeThirdPerson) {
        const originalSetCamera = renderer.setCamera;
        const wrappedSetCamera = function thirdPersonSetCamera(pos, yaw, pitch, ...rest) {
          if (!enabled || game.state !== 'play' || game.ui?.screen || !game.perspective || !pos || pos.length < 3) {
            return originalSetCamera.call(this, pos, yaw, pitch, ...rest);
          }

          if (Math.abs(distance - 4.0) < 0.02 && Math.abs(height) < 0.01) {
            return originalSetCamera.call(this, pos, yaw, pitch, ...rest);
          }

          const eye = realEye(game);
          if (!eye) {
            return originalSetCamera.call(this, pos, yaw, pitch, ...rest);
          }

          const dx = Number(pos[0]) - eye[0];
          const dy = Number(pos[1]) - eye[1];
          const dz = Number(pos[2]) - eye[2];
          const curDist = Math.hypot(dx, dy, dz);

          if (!Number.isFinite(curDist) || curDist < 0.05) {
            return originalSetCamera.call(this, pos, yaw, pitch, ...rest);
          }

          const dirX = dx / curDist;
          const dirY = dy / curDist;
          const dirZ = dz / curDist;

          // Native game already raycast-clamped curDist to <= 4.0
          let targetDist = distance <= 4.0
            ? curDist * (distance / 4.0)
            : (curDist < 3.9 ? curDist : distance);

          let tx = eye[0] + dirX * targetDist;
          let ty = eye[1] + dirY * targetDist + height;
          let tz = eye[2] + dirZ * targetDist;

          if (wallCheck && typeof game.raycast === 'function') {
            const rdx = tx - eye[0];
            const rdy = ty - eye[1];
            const rdz = tz - eye[2];
            const rLen = Math.hypot(rdx, rdy, rdz);
            if (rLen > 0.05) {
              try {
                const hit = game.raycast(
                  eye,
                  [rdx / rLen, rdy / rLen, rdz / rLen],
                  rLen,
                  false,
                  true
                );
                if (hit && Array.isArray(hit.point)) {
                  const hitDist = Math.hypot(
                    hit.point[0] - eye[0],
                    hit.point[1] - eye[1],
                    hit.point[2] - eye[2]
                  );
                  if (Number.isFinite(hitDist) && hitDist < rLen) {
                    const safeDist = Math.max(0.05, hitDist - 0.2);
                    tx = eye[0] + (rdx / rLen) * safeDist;
                    ty = eye[1] + (rdy / rLen) * safeDist;
                    tz = eye[2] + (rdz / rLen) * safeDist;
                  }
                }
              } catch {}
            }
          }

          const nextPos = Array.isArray(pos) ? [tx, ty, tz] : new pos.constructor([tx, ty, tz]);
          return originalSetCamera.call(this, nextPos, yaw, pitch, ...rest);
        };
        Object.defineProperty(wrappedSetCamera, '__solsticeThirdPerson', { value: true });
        renderer.setCamera = wrappedSetCamera;
      }
    }

    installHooks();
    setInterval(installHooks, 250);
  }
})();
