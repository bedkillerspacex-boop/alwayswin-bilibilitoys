

(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-esp';
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
    const module = getMod('ESP');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const color = (typeof themed === 'function' ? themed(0) : [255, 80, 160])
      .map((value) => Math.max(0, Math.min(255, Math.round(value))));

    const config = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(module.on),
      filled: Boolean(setting(module, 'Render Filled', true)),
      local: Boolean(setting(module, 'Render Local', false)),
      friends: Boolean(setting(module, 'Show Friends', true)),
      color
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
    name: 'ESP',
    desc: 'Draws a box around entities',
    cat: "Visual",
    nm: { l: 'esp', ls: 'esp', n: 'ESP', ns: 'ESP' },
    disp: '',
    settings: [
      { t: 'e', n: 'Style', d: 'The style of the ESP.', v: 0, vals: ['3D'] },
      { t: 'b', n: 'Render Filled', d: 'Whether or not to render the ESP filled.', v: 1 },
      { t: 'b', n: 'Render Local', d: 'Whether or not to render the ESP on the local player.', v: 0 },
      { t: 'b', n: 'Show Friends', d: 'Whether or not to render the ESP on teammates.', v: 1 }
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
    const BOX_HALF_WIDTH = 0.35;
    const FRIEND_COLOR = [0, 255, 0];
    let config = {
      enabled: false,
      filled: true,
      local: false,
      friends: true,
      color: [255, 80, 160]
    };
    let overlay = null;
    let overlayCtx = null;
    let overlayWidth = 0;
    let overlayHeight = 0;
    let overlayDpr = 0;
    let renderHookInstalled = false;

    function ensureOverlay() {
      if (overlay) {
        return overlay;
      }

      if (!document.documentElement) {
        return null;
      }

      const canvas = document.createElement('canvas');
      canvas.id = 'solstice-esp-overlay';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = [
        'position: fixed',
        'inset: 0',
        'display: block',
        'width: 100vw',
        'height: 100vh',
        'pointer-events: none',
        'z-index: 2147483647'
      ].join(';');

      document.documentElement.append(canvas);
      overlay = canvas;
      overlayCtx = canvas.getContext('2d');
      resizeOverlay();
      return overlay;
    }

    function resizeOverlay() {
      if (!overlay || !overlayCtx) {
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(window.innerWidth));
      const height = Math.max(1, Math.round(window.innerHeight));
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);

      if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) {
        overlay.width = pixelWidth;
        overlay.height = pixelHeight;
      }

      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      overlayWidth = width;
      overlayHeight = height;
      overlayDpr = dpr;
    }

    function clearOverlay() {
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, overlayWidth, overlayHeight);
      }
    }

    function convexHull(rawPoints) {
      const points = rawPoints
        .slice()
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

      if (points.length < 3) {
        return [];
      }

      const cross = (origin, a, b) => (
        (a[0] - origin[0]) * (b[1] - origin[1]) -
        (a[1] - origin[1]) * (b[0] - origin[0])
      );

      const lower = [];

      for (const point of points) {
        while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) {
          lower.pop();
        }

        lower.push(point);
      }

      const upper = [];

      for (let index = points.length - 1; index >= 0; index -= 1) {
        const point = points[index];

        while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) {
          upper.pop();
        }

        upper.push(point);
      }

      lower.pop();
      upper.pop();
      return lower.concat(upper);
    }

    function draw() {
      const canvas = ensureOverlay();

      if (!canvas || !overlayCtx) {
        return;
      }

      if (
        window.innerWidth !== overlayWidth ||
        window.innerHeight !== overlayHeight ||
        Math.min(window.devicePixelRatio || 1, 2) !== overlayDpr
      ) {
        resizeOverlay();
      }

      clearOverlay();

      if (!bridge.active || !config.enabled) {
        return;
      }

      const gh = bridge.getGH();

      if (!gh?.ready || gh.G.state !== 'playing') {
        return;
      }

      const debug = gh.debug;
      const camera = debug?.gfx?.camera;
      const player = debug?.player;
      const actors = debug?.match?.actors;

      if (!camera || !player?.pos || !Array.isArray(actors)) {
        return;
      }

      const renderActors = () => {
        const point = player.pos.clone();
        const forward = player.pos.clone();
        camera.getWorldDirection(forward);
        const width = overlayWidth;
        const height = overlayHeight;

        overlayCtx.lineJoin = 'round';
        overlayCtx.lineWidth = 2;

        for (const actor of actors) {
        if (!actor?.pos || actor.alive === false || actor.isK9) {
          continue;
        }

        const isSelf = actor === player;
        const isFriend = !isSelf && Number(actor.team) === Number(player.team);

        if (isSelf && !config.local) {
          continue;
        }

        if (isFriend && !config.friends) {
          continue;
        }

        const actorHeight = Number(actor.e?.h) > 0.2 ? Number(actor.e.h) : 1.8;
        const x = actor.pos.x;
        const y = actor.pos.y;
        const z = actor.pos.z;
        const minX = x - BOX_HALF_WIDTH;
        const maxX = x + BOX_HALF_WIDTH;
        const minZ = z - BOX_HALF_WIDTH;
        const maxZ = z + BOX_HALF_WIDTH;
        const minY = y + 0.01;
        const maxY = y + actorHeight + 0.02;
        const corners = [
          [minX, minY, minZ], [minX, minY, maxZ],
          [minX, maxY, minZ], [minX, maxY, maxZ],
          [maxX, minY, minZ], [maxX, minY, maxZ],
          [maxX, maxY, minZ], [maxX, maxY, maxZ]
        ];
        const projected = [];
        let valid = true;

        for (const corner of corners) {
          point.set(corner[0], corner[1], corner[2]);

          const dx = point.x - camera.position.x;
          const dy = point.y - camera.position.y;
          const dz = point.z - camera.position.z;

          if (dx * forward.x + dy * forward.y + dz * forward.z <= 0.06) {
            valid = false;
            break;
          }

          point.project(camera);

          if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
            valid = false;
            break;
          }

          if (point.z < -1 || point.z > 1) {
            valid = false;
            break;
          }

          projected.push([
            (point.x * 0.5 + 0.5) * width,
            (-point.y * 0.5 + 0.5) * height
          ]);
        }

        if (!valid) {
          continue;
        }

        const hull = convexHull(projected);

        if (hull.length < 3) {
          continue;
        }

        const color = isFriend ? FRIEND_COLOR : config.color;

        overlayCtx.beginPath();
        overlayCtx.moveTo(hull[0][0], hull[0][1]);

        for (let index = 1; index < hull.length; index += 1) {
          overlayCtx.lineTo(hull[index][0], hull[index][1]);
        }

        overlayCtx.closePath();

        if (config.filled) {
          overlayCtx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.25)`;
          overlayCtx.fill();
        }

        overlayCtx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)`;
        overlayCtx.stroke();
        }
      };

      const thirdPerson = typeof bridge.getFeature === 'function' ? bridge.getFeature('thirdperson') : null;

      if (thirdPerson && typeof thirdPerson.withCamera === 'function') {
        thirdPerson.withCamera(camera, renderActors);
      } else {
        renderActors();
      }
    }

    function installRenderHook() {
      const gfx = bridge.getGH()?.debug?.gfx;

      if (!gfx || typeof gfx.render !== 'function' || gfx.render.__solsticeEspWrapped) {
        return;
      }

      const originalRender = gfx.render;
      const wrappedRender = function wrappedRender(...args) {
        const result = originalRender.apply(this, args);

        try {
          draw();
        } catch {

        }

        return result;
      };

      Object.defineProperty(wrappedRender, '__solsticeEspWrapped', { value: true });
      gfx.render = wrappedRender;
      renderHookInstalled = true;
    }

    function fallbackDrawLoop() {
      window.requestAnimationFrame(fallbackDrawLoop);

      if (!renderHookInstalled) {
        try {
          draw();
        } catch {

        }
      }
    }

    bridge.onConfig('solstice-esp', (data) => {
      if (data.type !== 'config') {
        return;
      }

      const color = Array.isArray(data.color) && data.color.length >= 3
        ? data.color.slice(0, 3).map((value) => {
          const number = Number(value);
          return Number.isFinite(number) ? Math.max(0, Math.min(255, Math.round(number))) : 0;
        })
        : config.color;

      config = {
        enabled: Boolean(data.enabled),
        filled: data.filled !== false,
        local: Boolean(data.local),
        friends: data.friends !== false,
        color
      };

      if (!config.enabled) {
        clearOverlay();
      }
    });

    window.addEventListener('resize', resizeOverlay);
    installRenderHook();
    setInterval(installRenderHook, 250);
    window.requestAnimationFrame(fallbackDrawLoop);
  }
})();
