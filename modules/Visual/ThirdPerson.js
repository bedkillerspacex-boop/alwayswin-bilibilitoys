(() => {
  'use strict';

  /* 第三人称：绑键后按下即切换。摄像机只在渲染那一瞬间被推到身后，
     渲染完立刻还原，所以游戏自己的射线 / 命中判定仍然从眼睛出发。 */

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-visual';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 400;

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

  function valueOf(module, name, fallback) {
    const setting = module.settings.find((entry) => entry.n === name);
    const value = setting ? setting.v : fallback;
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function syncConfig() {
    const module = getMod('ThirdPerson');

    if (!module) {
      return;
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'thirdperson',
      enabled: Boolean(module.on),
      distance: valueOf(module, 'Distance', 3.2),
      height: valueOf(module, 'Height', 0.35),
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
    name: 'ThirdPerson',
    desc: 'Moves the camera behind you while the keybind is held on.',
    cat: 'Visual',
    nm: { l: 'thirdperson', ls: 'third person', n: 'ThirdPerson', ns: 'Third Person' },
    disp: 'Distance',
    settings: [
      { t: 'n', n: 'Distance', d: 'How far the camera sits behind you.', v: 3.2, min: 0.5, max: 10.0, step: 0.1 },
      { t: 'n', n: 'Height', d: 'Vertical offset of the camera.', v: 0.35, min: -1.0, max: 2.5, step: 0.05 },
      { t: 'b', n: 'Show Body', d: 'Forces your own model to stay visible.', v: 1 }
    ],
    renderOrder: 3,
    onRender: syncConfig,
    defaultOn: false,
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
    let distance = 3.2;
    let height = 0.35;
    let wantBody = true;
    let hooked = false;
    let rafId = 0;

    const applied = { x: 0, y: 0, z: 0 };
    const bodySaved = new Map();

    function gfx() {
      return window.GH?.debug?.gfx;
    }

    function player() {
      return window.GH?.debug?.player;
    }

    /* ── camera transform ─────────────────────────────────────────── */

    function forwardOf(camera) {
      const elements = camera?.matrixWorld?.elements;

      if (elements && elements.length >= 11) {
        const x = -elements[8];
        const y = -elements[9];
        const z = -elements[10];
        const length = Math.hypot(x, y, z) || 1;
        return { x: x / length, y: y / length, z: z / length };
      }

      const euler = camera?.rotation;

      if (euler && Number.isFinite(euler.x) && Number.isFinite(euler.y)) {
        const cp = Math.cos(euler.x);
        return {
          x: -Math.sin(euler.y) * cp,
          y: Math.sin(euler.x),
          z: -Math.cos(euler.y) * cp
        };
      }

      return { x: 0, y: 0, z: -1 };
    }

    /* 返回还原函数；会把上一次留下的偏移先撤掉，保证幂等 */
    function pushCamera(camera) {
      const pos = camera?.position;

      if (!pos || !Number.isFinite(pos.x)) {
        return null;
      }

      if (typeof camera.updateMatrixWorld === 'function') {
        try {
          camera.updateMatrixWorld();
        } catch {

        }
      }

      const forward = forwardOf(camera);
      const baseX = pos.x - applied.x;
      const baseY = pos.y - applied.y;
      const baseZ = pos.z - applied.z;

      const nextX = baseX - forward.x * distance;
      const nextY = baseY - forward.y * distance + height;
      const nextZ = baseZ - forward.z * distance;

      pos.x = nextX;
      pos.y = nextY;
      pos.z = nextZ;
      applied.x = nextX - baseX;
      applied.y = nextY - baseY;
      applied.z = nextZ - baseZ;

      return () => {
        pos.x = baseX;
        pos.y = baseY;
        pos.z = baseZ;
        applied.x = 0;
        applied.y = 0;
        applied.z = 0;

        if (typeof camera.updateMatrixWorld === 'function') {
          try {
            camera.updateMatrixWorld();
          } catch {

          }
        }
      };
    }

    /* ── own body visibility ──────────────────────────────────────── */

    function bodyTargets() {
      const self = player();
      const list = [
        self,
        self?.e,
        self?.mesh,
        self?.model,
        self?.object3d,
        self?.root,
        self?.e?.mesh,
        self?.e?.model,
        self?.e?.object3d,
        self?.e?.root
      ];
      const out = [];

      for (const candidate of list) {
        if (!candidate || typeof candidate !== 'object') continue;
        if (typeof candidate.visible !== 'boolean') continue;
        if (out.includes(candidate)) continue;
        out.push(candidate);
      }

      return out;
    }

    function setBodyVisible(wanted) {
      const targets = bodyTargets();

      if (wanted) {
        for (const target of targets) {
          if (!bodySaved.has(target)) {
            bodySaved.set(target, target.visible);
          }

          target.visible = true;
        }

        return;
      }

      for (const [target, previous] of bodySaved) {
        try {
          target.visible = previous;
        } catch {

        }
      }

      bodySaved.clear();
    }

    /* ── hook install ─────────────────────────────────────────────── */

    function tryHook() {
      const target = gfx();

      if (!target) {
        return false;
      }

      const candidates = [];

      if (target.renderer && typeof target.renderer.render === 'function') {
        candidates.push({ owner: target.renderer, key: 'render' });
      }

      if (typeof target.render === 'function') {
        candidates.push({ owner: target, key: 'render' });
      }

      for (const candidate of candidates) {
        const original = candidate.owner[candidate.key];

        if (original.__solsticeThirdPerson) {
          hooked = true;
          return true;
        }

        const gfxRef = target;

        const wrapped = function wrappedSolsticeRender(scene, camera) {
          let restore = null;

          if (enabled) {
            try {
              restore = pushCamera(camera || gfxRef.camera);
            } catch {

            }
          }

          try {
            return original.apply(this, arguments);
          } finally {
            if (restore) {
              try {
                restore();
              } catch {

              }
            }
          }
        };

        Object.defineProperty(wrapped, '__solsticeThirdPerson', { value: true });
        candidate.owner[candidate.key] = wrapped;
        hooked = true;
        return true;
      }

      return false;
    }

    /* 找不到渲染器时的兜底：每帧重新推一次，靠 applied 抵消累积 */
    function loop() {
      rafId = requestAnimationFrame(loop);

      if (!enabled || hooked) {
        return;
      }

      const camera = gfx()?.camera;

      if (camera) {
        try {
          pushCamera(camera);
        } catch {

        }
      }
    }

    function resetCamera() {
      const camera = gfx()?.camera;
      const pos = camera?.position;

      if (pos && (applied.x || applied.y || applied.z)) {
        pos.x -= applied.x;
        pos.y -= applied.y;
        pos.z -= applied.z;
      }

      applied.x = 0;
      applied.y = 0;
      applied.z = 0;
    }

    bridge.onConfig('solstice-visual', (data) => {
      if (data.type !== 'config' || data.module !== 'thirdperson') {
        return;
      }

      const wasEnabled = enabled;
      enabled = Boolean(data.enabled);
      distance = Number.isFinite(Number(data.distance)) ? Number(data.distance) : 3.2;
      height = Number.isFinite(Number(data.height)) ? Number(data.height) : 0.35;
      wantBody = data.body !== false;

      if (enabled) {
        if (!hooked) {
          tryHook();
        }

        setBodyVisible(wantBody);

        if (!rafId) {
          rafId = requestAnimationFrame(loop);
        }
      } else if (wasEnabled) {
        setBodyVisible(false);
        resetCamera();
      }
    });

    bridge.onReset(() => {
      if (!enabled) {
        setBodyVisible(false);
        resetCamera();
      }
    });

      setInterval(() => {
        if (enabled && !hooked) {
          tryHook();
        }
      }, 500);

      function updateCameraMatrices(camera) {
        if (typeof camera?.updateMatrixWorld === 'function') {
          try {
            camera.updateMatrixWorld();
          } catch {

          }
        }

        if (camera?.matrixWorld && camera?.matrixWorldInverse?.copy) {
          try {
            camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
          } catch {

          }
        }
      }

      if (typeof bridge.provide === 'function') {
        bridge.provide('thirdperson', {
          withCamera(camera, fn) {
            if (!enabled || !camera) {
              return fn();
            }

            if (applied.x || applied.y || applied.z) {
              updateCameraMatrices(camera);
              return fn();
            }

            const restore = pushCamera(camera);
            updateCameraMatrices(camera);

            try {
              return fn();
            } finally {
              if (restore) {
                restore();
              }

              updateCameraMatrices(camera);
            }
          }
        });
      }
  }
})();
