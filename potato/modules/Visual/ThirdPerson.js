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

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'thirdperson',
      enabled: Boolean(module.on),
      distance: valueOf(module, 'Distance', 3.2),
      height: valueOf(module, 'Height', 0.35),
      wallCheck: Boolean((module.settings.find((s) => s.n === 'Wall Check') || { v: 1 }).v),
      body: Boolean((module.settings.find((s) => s.n === 'Show Body') || { v: 1 }).v)
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
    desc: 'Moves the camera behind your player in PotatoEpic.',
    cat: 'Visual',
    nm: { l: 'thirdperson', ls: 'third person', n: 'ThirdPerson', ns: 'Third Person' },
    disp: 'Distance',
    settings: [
      { t: 'n', n: 'Distance', d: 'How far the camera sits behind you.', v: 3.2, min: 0.5, max: 10.0, step: 0.1 },
      { t: 'n', n: 'Height', d: 'Vertical offset of the camera.', v: 0.35, min: -1.0, max: 2.5, step: 0.05 },
      { t: 'b', n: 'Show Body', d: 'Renders your local player body when supported.', v: 1 },
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
    let distance = 3.2;
    let height = 0.35;
    let wallCheck = true;
    let wantBody = true;
    let lastRealEye = null;

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'thirdperson') {
        return;
      }
      enabled = Boolean(data.enabled);
      distance = bridge.clamp(Number(data.distance) || 3.2, 0.5, 10.0);
      height = bridge.clamp(Number(data.height) || 0.35, -1.0, 2.5);
      wallCheck = data.wallCheck !== false;
      wantBody = data.body !== false;
    });

    if (typeof bridge.provide === 'function') {
      bridge.provide('thirdperson', {
        getEye() {
          if (lastRealEye) {
            return { x: lastRealEye[0], y: lastRealEye[1], z: lastRealEye[2] };
          }
          const game = window.game;
          const player = game?.player;
          if (!player) return null;
          try {
            const eye = typeof window.XZ?.eyeOf === 'function' ? window.XZ.eyeOf(player) : null;
            if (eye && eye.every(Number.isFinite)) {
              return { x: eye[0], y: eye[1], z: eye[2] };
            }
          } catch {}
          const pos = player.pos;
          if (!pos) return null;
          return {
            x: Number(pos[0]) || 0,
            y: (Number(pos[1]) || 0) + (Number(player.h) || 1.8) * 0.9,
            z: Number(pos[2]) || 0
          };
        }
      });
    }

    function installHooks() {
      const game = window.game;
      const renderer = game?.renderer;
      if (!game || !renderer) return;

      if (typeof renderer.setCamera === 'function' && !renderer.setCamera.__solsticeThirdPerson) {
        const originalSetCamera = renderer.setCamera;
        const wrappedSetCamera = function thirdPersonSetCamera(pos, yaw, pitch, ...rest) {
          if (!enabled || game.state !== 'play' || game.ui?.screen || !pos || typeof pos.length !== 'number' || pos.length < 3) {
            lastRealEye = null;
            return originalSetCamera.call(this, pos, yaw, pitch, ...rest);
          }

          const ex = Number(pos[0]);
          const ey = Number(pos[1]);
          const ez = Number(pos[2]);
          if (!Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(ez)) {
            lastRealEye = null;
            return originalSetCamera.call(this, pos, yaw, pitch, ...rest);
          }
          lastRealEye = [ex, ey, ez];

          const y = Number(yaw) || 0;
          const p = Number(pitch) || 0;
          const cos = Math.cos(p);
          const bx = Math.sin(y) * cos;
          const by = -Math.sin(p);
          const bz = Math.cos(y) * cos;

          let tx = ex + bx * distance;
          let ty = ey + by * distance + height;
          let tz = ez + bz * distance;

          if (wallCheck && typeof game.raycast === 'function') {
            const dx = tx - ex;
            const dy = ty - ey;
            const dz = tz - ez;
            const len = Math.hypot(dx, dy, dz);
            if (len > 0.05) {
              try {
                const hit = game.raycast(
                  [ex, ey, ez],
                  [dx / len, dy / len, dz / len],
                  len,
                  false,
                  true
                );
                if (hit && Number.isFinite(Number(hit.t)) && Number(hit.t) < len) {
                  const hitT = Number(hit.t);
                  const safeT = Math.max(0, Math.min(hitT * 0.8, hitT - 0.25));
                  tx = ex + (dx / len) * safeT;
                  ty = ey + (dy / len) * safeT;
                  tz = ez + (dz / len) * safeT;
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
