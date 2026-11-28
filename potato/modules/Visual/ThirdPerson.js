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
      distance: valueOf(module, 'Distance', 3.5),
      height: valueOf(module, 'Height', 0.35),
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
      { t: 'n', n: 'Distance', d: 'How far the camera sits from your player.', v: 3.5, min: 0.5, max: 10.0, step: 0.1 },
      { t: 'n', n: 'Height', d: 'Vertical offset of the camera.', v: 0.35, min: -1.0, max: 2.5, step: 0.05 },
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
    let distance = 3.5;
    let height = 0.35;
    let wallCheck = true;
    let activeInMatch = false;
    let savedPerspective = 0;

    function isInMatch(game) {
      const xzeR = window.XZE?.R;
      return Boolean(
        game &&
        game.state === 'play' &&
        !game.ui?.screen &&
        game.player &&
        (!xzeR || xzeR.st === 'play')
      );
    }

    function potatoCamHandler(game, r, yaw, pitch) {
      if (!enabled || !isInMatch(game) || !r || r.length < 3) {
        return null;
      }

      const sign = mode === 'Front' ? -1 : 1;
      const cos = Math.cos(pitch);
      const fx = -Math.sin(yaw) * cos;
      const fy = Math.sin(pitch);
      const fz = -Math.cos(yaw) * cos;

      let tx = r[0] - fx * distance * sign;
      let ty = r[1] - fy * distance * sign + height;
      let tz = r[2] - fz * distance * sign;

      if (wallCheck && typeof game?.raycast === 'function') {
        const dx = tx - r[0];
        const dy = ty - r[1];
        const dz = tz - r[2];
        const len = Math.hypot(dx, dy, dz);
        if (len > 0.05) {
          try {
            const hit = game.raycast(
              [r[0], r[1], r[2]],
              [dx / len, dy / len, dz / len],
              len,
              false,
              true
            );
            if (hit && Array.isArray(hit.point)) {
              const hitDist = Math.hypot(
                hit.point[0] - r[0],
                hit.point[1] - r[1],
                hit.point[2] - r[2]
              );
              if (Number.isFinite(hitDist) && hitDist < len) {
                const safeDist = Math.max(0.05, hitDist - 0.2);
                tx = r[0] + (dx / len) * safeDist;
                ty = r[1] + (dy / len) * safeDist;
                tz = r[2] + (dz / len) * safeDist;
              }
            }
          } catch {}
        }
      }

      return {
        pos: [tx, ty, tz],
        yaw: mode === 'Front' ? yaw + Math.PI : yaw,
        pitch: mode === 'Front' ? -pitch : pitch
      };
    }

    function syncMatchState() {
      const game = window.game;
      const shouldActivate = enabled && isInMatch(game);

      if (shouldActivate) {
        if (!activeInMatch) {
          savedPerspective = Number(game.perspective) || 0;
          activeInMatch = true;
        }
        if (window.POTATO_CAM !== potatoCamHandler) {
          window.POTATO_CAM = potatoCamHandler;
        }
        game.perspective = mode === 'Front' ? 2 : 1;
      } else if (activeInMatch) {
        activeInMatch = false;
        if (window.POTATO_CAM === potatoCamHandler) {
          window.POTATO_CAM = null;
        }
        if (game) {
          game.perspective = savedPerspective === 0 ? 0 : savedPerspective;
        }
      }
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'thirdperson') {
        return;
      }
      enabled = Boolean(data.enabled);
      mode = data.mode === 'Front' ? 'Front' : 'Back';
      distance = bridge.clamp(Number(data.distance) || 3.5, 0.5, 10.0);
      height = bridge.clamp(Number(data.height) || 0.35, -1.0, 2.5);
      wallCheck = data.wallCheck !== false;
      syncMatchState();
    });

    if (typeof bridge.provide === 'function') {
      bridge.provide('thirdperson', {
        getEye: () => bridge.getEye()
      });
    }

    bridge.onBeforePlayerUpdate(syncMatchState);
    setInterval(syncMatchState, 100);
  }
})();
