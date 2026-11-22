(() => {
  'use strict';

  const CHANNEL = 'solstice-damage-popups';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 100;
  const HEARTBEAT_MS = 500;

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
    const entry = module.settings.find((s) => s.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig() {
    const module = getMod('DamagePopups');

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
      enabled: Boolean(module.on),
      onlyMine: Boolean(setting(module, 'Only Mine', true)),
      headshotTag: Boolean(setting(module, 'Headshot Tag', true)),
      duration: Math.max(0.4, Math.min(2.5, Number(setting(module, 'Duration', 1.0)) || 1.0)),
      scale: Math.max(0.6, Math.min(2.0, Number(setting(module, 'Scale', 1.0)) || 1.0)),
      floatSpeed: Math.max(0.1, Math.min(2.5, Number(setting(module, 'Float Speed', 0.85)) || 0.85))
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
    name: 'DamagePopups',
    desc: 'Displays floating damage numbers at the 3D hit position.',
    cat: 'Visual',
    nm: { l: 'damagepopups', ls: 'damage popups', n: 'DamagePopups', ns: 'Damage Popups' },
    disp: '',
    settings: [
      { t: 'b', n: 'Only Mine', d: 'Only show damage popups for hits you deal.', v: 1 },
      { t: 'b', n: 'Headshot Tag', d: 'Highlight headshots with a HS badge.', v: 1 },
      { t: 'n', n: 'Duration', d: 'Lifetime of each popup in seconds.', v: 1.0, min: 0.4, max: 2.5, step: 0.1 },
      { t: 'n', n: 'Scale', d: 'Text scale multiplier.', v: 1.0, min: 0.6, max: 2.0, step: 0.05 },
      { t: 'n', n: 'Float Speed', d: 'Upward float speed in world units per second.', v: 0.85, min: 0.1, max: 2.5, step: 0.05 }
    ],
    onRender: syncConfig,
    onEnable() {
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
    const MAX_POPUPS = 64;
    const NORMAL_COLOR = '#ffffff';
    const HEADSHOT_COLOR = '#ff4b5c';
    const LETHAL_COLOR = '#ffd166';

    let config = {
      enabled: false,
      onlyMine: true,
      headshotTag: true,
      duration: 1.0,
      scale: 1.0,
      floatSpeed: 0.85
    };

    const popups = [];
    let overlayCanvas = null;
    let overlayCtx = null;
    let overlayWidth = 0;
    let overlayHeight = 0;
    let overlayDpr = 1;
    let hadContent = false;
    let renderHookInstalled = false;
    let lastOverlayDrawAt = 0;
    let tempPoint = null;
    let tempForward = null;

    function isVec3Array(value) {
      return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
    }

    function pushDamagePopup(engine, event) {
      if (!config.enabled || !event || event.type !== 'damage') {
        return;
      }

      const myId = engine?.net?.id;

      if (event.id === myId) {
        return;
      }

      if (config.onlyMine && event.attacker !== myId) {
        return;
      }

      const amount = Math.round(Number(event.amount) || 0);

      if (amount <= 0) {
        return;
      }

      let x = 0;
      let y = 0;
      let z = 0;

      if (isVec3Array(event.point)) {
        [x, y, z] = event.point;
      } else {
        const victim = typeof engine?.actor === 'function' ? engine.actor(event.id) : null;

        if (!victim?.pos) {
          return;
        }

        const height = victim.e?.h || 1.8;
        x = victim.pos.x;
        y = victim.pos.y + (event.head ? height - 0.17 : height * 0.6);
        z = victim.pos.z;
      }

      if (popups.length >= MAX_POPUPS) {
        popups.shift();
      }

      popups.push({
        x,
        y,
        z,
        vx: (Math.random() - 0.5) * 0.35,
        vz: (Math.random() - 0.5) * 0.35,
        amount,
        head: Boolean(event.head),
        lethal: Number(event.hp) <= 0,
        createdAt: performance.now()
      });
    }

    function installEventHook() {
      const engine = bridge.getEngineState?.()?.engine || window.GH?.debug?.engine;

      if (!engine || typeof engine.applyEvent !== 'function' || engine.applyEvent.__solsticeDamagePopups) {
        return;
      }

      const originalApplyEvent = engine.applyEvent;
      const wrappedApplyEvent = function wrappedDamagePopupsApplyEvent(event, ...rest) {
        const result = originalApplyEvent.call(this, event, ...rest);

        try {
          if (event?.type === 'round-start') {
            popups.length = 0;
          } else {
            pushDamagePopup(this, event);
          }
        } catch {

        }

        return result;
      };

      Object.defineProperty(wrappedApplyEvent, '__solsticeDamagePopups', { value: true });
      engine.applyEvent = wrappedApplyEvent;
    }

    function ensureOverlay() {
      if (overlayCanvas && overlayCtx) {
        if (!overlayCanvas.isConnected && document.documentElement) {
          document.documentElement.append(overlayCanvas);
        }

        return overlayCanvas.isConnected;
      }

      if (!document.documentElement) {
        return false;
      }

      overlayCanvas = document.createElement('canvas');
      overlayCanvas.id = 'solstice-damage-popups-overlay';
      overlayCanvas.setAttribute('aria-hidden', 'true');
      overlayCanvas.style.cssText = [
        'position: fixed',
        'inset: 0',
        'display: block',
        'width: 100vw',
        'height: 100vh',
        'pointer-events: none',
        'z-index: 2147483647'
      ].join(';');

      document.documentElement.append(overlayCanvas);
      overlayCtx = overlayCanvas.getContext('2d');
      resizeCanvas();
      return Boolean(overlayCtx);
    }

    function resizeCanvas() {
      if (!overlayCanvas || !overlayCtx) {
        return;
      }

      const dprCap = Number(bridge.maxDpr) > 0 ? Number(bridge.maxDpr) : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);

      if (overlayCanvas.width !== pixelWidth || overlayCanvas.height !== pixelHeight) {
        overlayCanvas.width = pixelWidth;
        overlayCanvas.height = pixelHeight;
      }

      overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      overlayWidth = width;
      overlayHeight = height;
      overlayDpr = dpr;
    }

    function clearOverlay() {
      if (!overlayCtx || !hadContent) {
        return;
      }

      overlayCtx.clearRect(0, 0, overlayWidth, overlayHeight);
      hadContent = false;
    }

    function pruneExpired(now) {
      const maxAgeMs = config.duration * 1000;

      while (popups.length > 0 && now - popups[0].createdAt >= maxAgeMs) {
        popups.shift();
      }
    }

    function draw() {
      if (!config.enabled || bridge.uiOpen) {
        clearOverlay();
        return;
      }

      const minInterval = Number(bridge.overlayMinIntervalMs) || 0;
      const now = performance.now();

      if (minInterval > 0) {
        if (now - lastOverlayDrawAt < minInterval - 1) {
          return;
        }
        lastOverlayDrawAt = now;
      }

      pruneExpired(now);

      if (popups.length === 0) {
        clearOverlay();
        return;
      }

      if (!ensureOverlay()) {
        return;
      }

      const dprCap = Number(bridge.maxDpr) > 0 ? Number(bridge.maxDpr) : 2;

      if (
        window.innerWidth !== overlayWidth ||
        window.innerHeight !== overlayHeight ||
        Math.min(window.devicePixelRatio || 1, dprCap) !== overlayDpr
      ) {
        resizeCanvas();
      }

      clearOverlay();

      const gh = bridge.getGH();

      if (!gh?.ready || gh.G.state !== 'playing') {
        return;
      }

      const camera = gh.debug?.gfx?.camera;
      const three = gh.three;

      if (!camera || !three?.Vector3) {
        return;
      }

      if (!tempPoint) {
        tempPoint = new three.Vector3();
      }

      if (!tempForward) {
        tempForward = new three.Vector3();
      }

      camera.getWorldDirection(tempForward);
      const width = overlayWidth;
      const height = overlayHeight;
      const baseFontSize = 16 * config.scale;

      overlayCtx.textAlign = 'center';
      overlayCtx.textBaseline = 'middle';
      overlayCtx.lineJoin = 'round';
      overlayCtx.strokeStyle = 'rgba(0, 0, 0, 0.88)';

      for (const popup of popups) {
        const ageSec = (now - popup.createdAt) / 1000;
        const progress = Math.min(1, Math.max(0, ageSec / config.duration));
        const easeOut = 1 - (1 - progress) * (1 - progress);
        const spreadTime = Math.min(ageSec, 0.35);

        const wx = popup.x + popup.vx * spreadTime;
        const wy = popup.y + config.floatSpeed * ageSec + 0.16 * easeOut;
        const wz = popup.z + popup.vz * spreadTime;

        const dx = wx - camera.position.x;
        const dy = wy - camera.position.y;
        const dz = wz - camera.position.z;

        if (dx * tempForward.x + dy * tempForward.y + dz * tempForward.z <= 0.1) {
          continue;
        }

        tempPoint.set(wx, wy, wz).project(camera);

        if (
          !Number.isFinite(tempPoint.x) ||
          !Number.isFinite(tempPoint.y) ||
          !Number.isFinite(tempPoint.z) ||
          tempPoint.z < -1 ||
          tempPoint.z > 1
        ) {
          continue;
        }

        const sx = (tempPoint.x * 0.5 + 0.5) * width;
        const sy = (-tempPoint.y * 0.5 + 0.5) * height;
        const alpha = progress <= 0.6 ? 1 : Math.max(0, 1 - (progress - 0.6) / 0.4);
        const bounce = ageSec < 0.12 ? 1 + 0.28 * (1 - ageSec / 0.12) : 1;
        const fontSize = Math.round(baseFontSize * bounce * (popup.head ? 1.12 : 1));
        const label = popup.head && config.headshotTag ? `-${popup.amount} HS` : `-${popup.amount}`;

        overlayCtx.save();
        overlayCtx.globalAlpha = alpha;
        overlayCtx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`;
        overlayCtx.lineWidth = Math.max(2.5, fontSize * 0.22);
        overlayCtx.fillStyle = popup.head
          ? HEADSHOT_COLOR
          : popup.lethal
            ? LETHAL_COLOR
            : NORMAL_COLOR;

        overlayCtx.strokeText(label, sx, sy);
        overlayCtx.fillText(label, sx, sy);
        overlayCtx.restore();
        hadContent = true;
      }
    }

    const hookedGfx = new WeakSet();

    function installRenderHook() {
      const gfx = bridge.getGH()?.debug?.gfx;

      if (!gfx || typeof gfx.render !== 'function' || hookedGfx.has(gfx) || gfx.render.__solsticeDamagePopupsWrapped) {
        return;
      }

      hookedGfx.add(gfx);
      const originalRender = gfx.render;
      const wrappedRender = function wrappedDamagePopupsRender(...args) {
        const result = originalRender.apply(this, args);

        try {
          draw();
        } catch {

        }

        return result;
      };

      Object.defineProperty(wrappedRender, '__solsticeDamagePopupsWrapped', { value: true });
      gfx.render = wrappedRender;
      renderHookInstalled = true;
    }

    function fallbackDrawLoop() {
      if (renderHookInstalled) {
        return;
      }

      window.requestAnimationFrame(fallbackDrawLoop);

      try {
        draw();
      } catch {

      }
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }

      config = {
        enabled: Boolean(data.enabled),
        onlyMine: data.onlyMine !== false,
        headshotTag: data.headshotTag !== false,
        duration: Math.max(0.4, Math.min(2.5, Number(data.duration) || 1.0)),
        scale: Math.max(0.6, Math.min(2.0, Number(data.scale) || 1.0)),
        floatSpeed: Math.max(0.1, Math.min(2.5, Number(data.floatSpeed) || 0.85))
      };

      if (!config.enabled) {
        popups.length = 0;
        clearOverlay();
      }
    });

    bridge.onReset(() => {
      popups.length = 0;
      clearOverlay();
    });

    window.addEventListener('resize', resizeCanvas);
    installEventHook();
    installRenderHook();
    setInterval(() => {
      installEventHook();
      installRenderHook();
    }, 500);
    window.requestAnimationFrame(fallbackDrawLoop);
  }
})();
