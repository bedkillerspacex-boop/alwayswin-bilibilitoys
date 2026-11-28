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
    const module = getMod('InfAmmo');

    if (!module) {
      return;
    }

    const lastBullet = Boolean(module.settings.find((s) => s.n === 'Last Bullet')?.v);
    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'infammo',
      enabled: Boolean(module.on),
      lastBullet
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
    name: 'InfAmmo',
    desc: 'Infinite magazine and reserve ammunition.',
    cat: 'Combat',
    nm: { l: 'infammo', ls: 'inf ammo', n: 'InfAmmo', ns: 'Inf Ammo' },
    disp: '',
    settings: [
      { t: 'b', n: 'Last Bullet', d: 'Only keep infinite ammo when down to the last bullet.', v: 0 }
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
    let lastBullet = false;
    let setRoundsWrapped = false;
    let ammoCountWrapped = false;
    let takeAmmoWrapped = false;

    function heldAtLastBullet(xz) {
      try {
        const held = window.game?.player?.inv?.held;
        if (!held || !xz.isGun?.(held)) return false;
        const r = typeof xz.rounds === 'function' ? Number(xz.rounds(held)) : Number(held.xz?.rounds);
        return Number.isFinite(r) && r <= 1;
      } catch {
        return false;
      }
    }

    function installWrappers() {
      const xz = window.XZ;

      if (!xz) {
        return;
      }

      if (!setRoundsWrapped && typeof xz.setRounds === 'function') {
        const originalSetRounds = xz.setRounds;
        const wrappedSetRounds = function infAmmoSetRounds(item, rounds) {
          if (enabled && xz.isGun(item)) {
            if (lastBullet) {
              if (Number(rounds) < 1) {
                return originalSetRounds.call(this, item, 1);
              }
              return originalSetRounds.call(this, item, rounds);
            }
            return originalSetRounds.call(this, item, xz.cap(item));
          }

          return originalSetRounds.call(this, item, rounds);
        };

        Object.defineProperty(wrappedSetRounds, '__solsticeInfAmmoRounds', { value: true });
        xz.setRounds = wrappedSetRounds;
        setRoundsWrapped = true;
      }

      if (!ammoCountWrapped && typeof xz.ammoCount === 'function') {
        const originalAmmoCount = xz.ammoCount;
        const wrappedAmmoCount = function infAmmoCount(...args) {
          if (enabled && (!lastBullet || heldAtLastBullet(xz))) {
            return 9999;
          }

          return originalAmmoCount.apply(this, args);
        };

        Object.defineProperty(wrappedAmmoCount, '__solsticeInfAmmoCount', { value: true });
        xz.ammoCount = wrappedAmmoCount;
        ammoCountWrapped = true;
      }

      if (!takeAmmoWrapped && typeof xz.takeAmmo === 'function') {
        const originalTakeAmmo = xz.takeAmmo;
        const wrappedTakeAmmo = function infAmmoTakeAmmo(player, ammo, count) {
          if (enabled && (!lastBullet || heldAtLastBullet(xz))) {
            return Math.max(0, Number(count) || 0);
          }

          return originalTakeAmmo.apply(this, arguments);
        };

        Object.defineProperty(wrappedTakeAmmo, '__solsticeInfAmmoTake', { value: true });
        xz.takeAmmo = wrappedTakeAmmo;
        takeAmmoWrapped = true;
      }
    }

    installWrappers();

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'infammo') {
        return;
      }

      enabled = Boolean(data.enabled);
      lastBullet = Boolean(data.lastBullet);
      installWrappers();
    });

    bridge.onBeforePlayerUpdate(() => {
      if (!enabled) {
        return;
      }

      const xz = window.XZ;
      const player = window.game?.player;
      const held = player?.inv?.held;

      if (xz && held && xz.isGun(held)) {
        xz.setRounds(held, xz.cap(held));
      }
    }, 15);

    setInterval(installWrappers, 500);
  }
})();
