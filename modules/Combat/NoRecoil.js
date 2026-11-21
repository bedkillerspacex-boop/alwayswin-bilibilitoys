

(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
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

  function syncConfig() {
    const module = getMod('NoRecoil');

    if (!module) {
      return;
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'norecoil',
      enabled: Boolean(module.on),
      noSpread: Boolean((module.settings.find((s) => s.n === 'No Spread') || { v: 1 }).v),
      stopMove: Boolean((module.settings.find((s) => s.n === 'Stop Move') || { v: 0 }).v)
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
    name: 'NoRecoil',
    desc: 'Removes weapon recoil, camera shake, and bullet spread.',
    cat: "Combat",
    nm: { l: 'norecoil', ls: 'no recoil', n: 'NoRecoil', ns: 'No Recoil' },
    disp: '',
    settings: [
      { t: 'b', n: 'No Spread', d: 'Keeps weapon spread at minimum (0) in all stances.', v: 1 },
      { t: 'b', n: 'Stop Move', d: 'Briefly stops movement input right before firing with minimal slowdown.', v: 0 }
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
    let noSpread = true;
    let stopMove = false;

    function isSpreadSuppressed() {
      return noSpread && bridge.isRecoilSuppressed();
    }

    bridge.setRecoilSuppressed('norecoil', false);

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type !== 'config' || data.module !== 'norecoil') {
        return;
      }

      noSpread = data.noSpread !== false;
      stopMove = Boolean(data.stopMove);
      bridge.setRecoilSuppressed('norecoil', Boolean(data.enabled));
    });

    bridge.onWorldMove((context) => {
      if (!stopMove || !bridge.isRecoilSuppressed() || !context?.localInput) {
        return;
      }

      const debug = bridge.getGH()?.debug;
      const arsenal = debug?.arsenal;
      const input = debug?.input;
      const aura = typeof bridge.getFeature === 'function' ? bridge.getFeature('aura') : null;
      const fireHeld =
        typeof input?.any === 'function'
          ? Boolean(input.any(['Mouse0']))
          : Boolean(input?.keys?.has('Mouse0'));
      const aboutToFire =
        (fireHeld || bridge.physicalLmb || Boolean(aura?.canFireNow?.())) &&
        arsenal &&
        arsenal.state === 'ready' &&
        Number(arsenal.cool) <= 0.03 &&
        (arsenal.slot?.ammo || 0) > 0;

      if (!aboutToFire) {
        return;
      }

      if (context.localInput === context.input) {
        context.localInput = { ...context.input };
      }

      context.localInput.forward = 0;
      context.localInput.right = 0;
      context.input.forward = 0;
      context.input.right = 0;
    }, 35);

    bridge.onBeforePlayerUpdate(() => {
      if (!bridge.isRecoilSuppressed()) {
        return;
      }

      const player = bridge.getGH()?.debug?.player;

      if (!player) {
        return;
      }

      player.recoilPitch = 0;
      player.recoilYaw = 0;
      player.shake = 0;
      player.gunShake = 0;
      player.kickPitch = 0;
      player.kickRoll = 0;
      player.kickPS = 0;
      player.kickRS = 0;
    }, 30);

    function installWrappers() {
      const debug = bridge.getGH()?.debug;

      if (!debug) {
        return;
      }

      const arsenal = debug.arsenal;

      if (arsenal && !arsenal.__solsticeNoSpreadPatched) {
        try {
          let storedSpread = Number(arsenal.spread) || 0;

          Object.defineProperty(arsenal, 'spread', {
            configurable: true,
            enumerable: true,
            get() {
              return isSpreadSuppressed() ? 0 : storedSpread;
            },
            set(value) {
              storedSpread = Number(value) || 0;
            }
          });

          Object.defineProperty(arsenal, '__solsticeNoSpreadPatched', { value: true });
        } catch {

        }
      }

      if (arsenal && isSpreadSuppressed()) {
        arsenal.bloom = 0;
      }

      const recoil = debug.arsenal?.recoil;

      if (recoil && typeof recoil.step === 'function' && !recoil.step.__solsticeNoRecoilWrapped) {
        const originalStep = recoil.step;
        const wrappedStep = function wrappedNoRecoilStep(dt, player) {
          if (!bridge.isRecoilSuppressed()) {
            return originalStep.call(this, dt, player);
          }

          const pitch = player.pitch;
          const yaw = player.yaw;
          const result = originalStep.call(this, dt, player);

          player.pitch = pitch;
          player.yaw = yaw;
          this.rp = 0;
          this.rvp = 0;
          this.ry = 0;
          this.rvy = 0;
          this.lp = pitch;
          this.ly = yaw;

          if (this.cam) {
            this.cam.pitch = 0;
            this.cam.yaw = 0;
            this.cam.roll = 0;
            this.cam.fov = 0;
            this.cam.back = 0;
            this.cam.up = 0;
          }

          if (this.wk) {
            this.wk.back = 0;
            this.wk.up = 0;
            this.wk.side = 0;
            this.wk.pitch = 0;
            this.wk.yaw = 0;
            this.wk.roll = 0;
          }

          return result;
        };

        Object.defineProperty(wrappedStep, '__solsticeNoRecoilWrapped', { value: true });
        recoil.step = wrappedStep;
      }

      const viewmodel = debug.ctx?.vm || debug.vm;

      if (viewmodel && typeof viewmodel.kick === 'function' && !viewmodel.kick.__solsticeNoRecoilWrapped) {
        const originalKick = viewmodel.kick;
        const wrappedKick = function wrappedNoRecoilKick(...args) {
          if (bridge.isRecoilSuppressed()) {
            return;
          }

          return originalKick.apply(this, args);
        };

        Object.defineProperty(wrappedKick, '__solsticeNoRecoilWrapped', { value: true });
        viewmodel.kick = wrappedKick;
      }
    }

    installWrappers();
    setInterval(installWrappers, 500);
  }
})();
