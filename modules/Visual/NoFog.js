(() => {
  'use strict';

  const CHANNEL = 'solstice-visual';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;
  const isPotatoPath = () => location.pathname.includes('/potatoepic/') || document.documentElement?.getAttribute('data-solstice-game') === 'potatoepic';

  if (
    location.hostname === 'www.bilibilitoy.com' &&
    (location.pathname.startsWith('/toy/golden-hour/') || location.pathname.startsWith('/toy/potatoepic/'))
  ) {
    bootGame();
    return;
  }

  let lastSentKey = '';
  let lastSentAt = 0;

  function findGameFrame() {
    const prefix = isPotatoPath() ? '/toy/potatoepic/' : '/toy/golden-hour/';
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}${prefix}`)) {
        return frame;
      }
    }
    return null;
  }

  function syncConfig(force = false) {
    const mod = typeof getMod === 'function' ? getMod('NoFog') : null;
    if (!mod) return;

    const now = performance.now();
    const payload = {
      channel: CHANNEL,
      type: 'config',
      module: 'nofog',
      enabled: Boolean(mod.on)
    };
    const key = JSON.stringify(payload);
    if (!force && key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) return;

    const frame = findGameFrame();
    if (!frame?.contentWindow) return;

    try {
      frame.contentWindow.postMessage(payload, GAME_ORIGIN);
      lastSentKey = key;
      lastSentAt = now;
    } catch {}
  }

  register({
    name: 'NoFog',
    desc: 'Removes distance and environment fog for clearer visibility.',
    cat: 'Visual',
    nm: { l: 'nofog', ls: 'no fog', n: 'NoFog', ns: 'No Fog' },
    disp: '',
    settings: [],
    onRender: () => syncConfig(false),
    defaultOn: false,
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncConfig(true);
    }
  });

  function bootGame() {
    let attempts = 0;
    function start() {
      const bridge = window.SolsticeGame;
      if (!bridge) {
        if (attempts++ < 120) setTimeout(start, 25);
        return;
      }
      installGame(bridge);
    }
    start();
  }

  function installGame(bridge) {
    let enabled = false;
    const hookedGames = new WeakSet();
    let savedGhFog = null;

    function installPotatoFogHook() {
      const g = window.game;
      if (!g || hookedGames.has(g) || typeof g.dimEnv !== 'function') return;
      hookedGames.add(g);

      const origDimEnv = g.dimEnv;
      const wrappedDimEnv = function noFogDimEnv(...args) {
        const res = origDimEnv.apply(this, args);
        if (enabled && res && typeof res === 'object') {
          res.fogNear = 1e6;
          res.fogFar = 2e6;
        }
        return res;
      };
      Object.defineProperty(wrappedDimEnv, '__solsticeNoFog', { value: true });
      g.dimEnv = wrappedDimEnv;
    }

    function syncGhFog() {
      const scene = window.GH?.debug?.gfx?.scene;
      const fog = scene?.fog;
      if (!fog) return;

      if (enabled) {
        if (!savedGhFog || savedGhFog.fog !== fog) {
          savedGhFog = {
            fog,
            near: fog.near,
            far: fog.far,
            density: fog.density
          };
        }
        if (typeof fog.near === 'number') fog.near = 1e6;
        if (typeof fog.far === 'number') fog.far = 2e6;
        if (typeof fog.density === 'number') fog.density = 0;
      } else if (savedGhFog && savedGhFog.fog === fog) {
        if (typeof savedGhFog.near === 'number') fog.near = savedGhFog.near;
        if (typeof savedGhFog.far === 'number') fog.far = savedGhFog.far;
        if (typeof savedGhFog.density === 'number') fog.density = savedGhFog.density;
        savedGhFog = null;
      }
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'nofog') return;
      enabled = Boolean(data.enabled);
      if (bridge.game === 'potatoepic') {
        installPotatoFogHook();
      } else {
        syncGhFog();
      }
    });

    if (bridge.game === 'potatoepic') {
      installPotatoFogHook();
      setInterval(installPotatoFogHook, 500);
    } else {
      bridge.onBeforePlayerUpdate(syncGhFog);
    }
  }
})();
