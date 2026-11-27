(() => {
  'use strict';

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;

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

  function syncConfig() {
    const module = getMod('FastShot');

    if (!module) {
      return;
    }

    const now = performance.now();
    const value = module.settings.find((entry) => entry.n === 'Speed');
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'fastshot',
      enabled: Boolean(module.on),
      speed: Math.max(1, Math.min(10, Math.round(Number(value?.v) || 1)))
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
    name: 'FastShot',
    desc: 'Increases weapon fire rate.',
    cat: 'Combat',
    nm: { l: 'fastshot', ls: 'fast shot', n: 'FastShot', ns: 'Fast Shot' },
    disp: 'Speed',
    settings: [
      {
        t: 'n',
        n: 'Speed',
        d: '1 is normal fire rate; 2-9 shorten the interval; 10 removes the interval.',
        v: 1,
        min: 1,
        max: 10,
        step: 1
      }
    ],
    onRender: syncConfig,
    onEnable() {
      lastSentAt = 0;
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
    let enabled = false;
    let speed = 1;
    const baseRates = new Map();

    function collectGuns() {
      const guns = window.XZ?.R?.guns;

      if (!guns) {
        return null;
      }

      for (const gun of Object.values(guns)) {
        if (gun && !baseRates.has(gun)) {
          baseRates.set(gun, Math.max(0.01, Number(gun.rate) || 1));
        }
      }

      return guns;
    }

    function apply() {
      const guns = collectGuns();

      if (!guns) {
        return;
      }

      const factor = !enabled || speed <= 1
        ? 1
        : speed >= 10
          ? 1e9
          : 9 / (10 - speed);

      for (const [gun, base] of baseRates) {
        const rate = base * factor;

        if (gun.rate !== rate) {
          gun.rate = rate;
        }
      }

    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'fastshot') {
        return;
      }

      enabled = Boolean(data.enabled);
      speed = Math.max(1, Math.min(10, Math.round(Number(data.speed) || 1)));
      apply();

      if (enabled && speed > 1) {
        const player = window.game?.player;
        const state = player && typeof window.XZ?.state === 'function' ? window.XZ.state(player) : null;

        if (state) {
          state.next = 0;
        }
      }
    });

    apply();
    setInterval(apply, 500);
  }
})();
