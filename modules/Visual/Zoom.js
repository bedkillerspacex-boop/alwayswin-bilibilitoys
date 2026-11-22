(() => {
  'use strict';

  const CHANNEL = 'solstice-zoom';
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
    const entry = module.settings.find((s) => s.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig() {
    const module = getMod('Zoom');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const smooth = Boolean(setting(module, 'Smooth', true));
    const speedSetting = module.settings.find((s) => s.n === 'Smooth Speed');

    if (speedSetting) {
      speedSetting.vis = smooth;
    }

    const config = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(module.on),
      zoom: Math.max(1.25, Math.min(10.0, Number(setting(module, 'Zoom', 2.5)) || 2.5)),
      smooth,
      smoothSpeed: Math.max(4, Math.min(30, Number(setting(module, 'Smooth Speed', 14)) || 14))
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
    name: 'Zoom',
    desc: 'Smoothly zooms camera FOV (works great with Hold bind mode).',
    cat: 'Visual',
    nm: { l: 'zoom', ls: 'zoom', n: 'Zoom', ns: 'Zoom' },
    disp: 'Zoom',
    settings: [
      { t: 'n', n: 'Zoom', d: 'Zoom magnification multiplier (1.25x - 10x).', v: 2.5, min: 1.25, max: 10.0, step: 0.05 },
      { t: 'b', n: 'Smooth', d: 'Smoothly interpolate camera zoom.', v: 1 },
      { t: 'n', n: 'Smooth Speed', d: 'Zoom interpolation speed.', v: 14, min: 4, max: 30, step: 1 }
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
    let config = {
      enabled: false,
      zoom: 2.5,
      smooth: true,
      smoothSpeed: 14
    };

    let baseFov = null;
    let currentZoom = 1;
    let lastAt = performance.now();

    function applyZoom() {
      const camera = bridge.getGH()?.debug?.gfx?.camera;

      if (!camera || typeof camera.updateProjectionMatrix !== 'function') {
        return;
      }

      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastAt) / 1000));
      lastAt = now;

      const targetZoom = config.enabled ? config.zoom : 1;

      if (currentZoom <= 1.001 && targetZoom === 1) {
        if (baseFov !== null && Math.abs(camera.fov - baseFov) > 0.05) {
          camera.fov = baseFov;
          camera.updateProjectionMatrix();
        }
        baseFov = camera.fov;
        currentZoom = 1;
        return;
      }

      if (baseFov === null) {
        baseFov = camera.fov || 75;
      }

      if (config.smooth) {
        const k = 1 - Math.exp(-config.smoothSpeed * dt);
        currentZoom += (targetZoom - currentZoom) * k;
      } else {
        currentZoom = targetZoom;
      }

      if (targetZoom === 1 && Math.abs(currentZoom - 1) < 0.01) {
        currentZoom = 1;
        camera.fov = baseFov;
        camera.updateProjectionMatrix();
        return;
      }

      const halfBaseRad = (baseFov * Math.PI) / 360;
      const zoomedFov = (2 * Math.atan(Math.tan(halfBaseRad) / Math.max(1, currentZoom)) * 180) / Math.PI;
      camera.fov = zoomedFov;
      camera.updateProjectionMatrix();
    }

    const hookedGfx = new WeakSet();

    function installRenderHook() {
      const gfx = bridge.getGH()?.debug?.gfx;

      if (!gfx || typeof gfx.render !== 'function' || hookedGfx.has(gfx) || gfx.render.__solsticeZoomWrapped) {
        return;
      }

      hookedGfx.add(gfx);
      const originalRender = gfx.render;
      const wrappedRender = function wrappedZoomRender(...args) {
        try {
          applyZoom();
        } catch {

        }

        return originalRender.apply(this, args);
      };

      Object.defineProperty(wrappedRender, '__solsticeZoomWrapped', { value: true });
      gfx.render = wrappedRender;
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }

      config = {
        enabled: Boolean(data.enabled),
        zoom: Math.max(1.25, Math.min(10.0, Number(data.zoom) || 2.5)),
        smooth: data.smooth !== false,
        smoothSpeed: Math.max(4, Math.min(30, Number(data.smoothSpeed) || 14))
      };
    });

    bridge.onReset(() => {
      currentZoom = 1;
      const camera = bridge.getGH()?.debug?.gfx?.camera;

      if (camera && baseFov !== null) {
        camera.fov = baseFov;
        camera.updateProjectionMatrix();
      }
    });

    installRenderHook();
    setInterval(installRenderHook, 500);
  }
})();
