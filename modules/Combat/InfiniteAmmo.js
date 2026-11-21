(() => {
  'use strict';

  /* InfiniteAmmo：改写为「换弹时允许开火」+「弹匣不满时自动换弹」：
     - 换弹时：保留 arsenal.update() 推进换弹动画与 _load()，若满足开火条件则在更新后直接调用 arsenal._fire()
     - 自动换弹：当处于 ready 状态且 slot.ammo < slot.def.mag、备弹 > 0 时调用 arsenal.startReload() */

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-combat';
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

  function boolOf(module, name, fallback) {
    const setting = module.settings.find((entry) => entry.n === name);
    return setting ? Boolean(setting.v) : fallback;
  }

  function syncConfig() {
    const module = getMod('InfiniteAmmo');

    if (!module) {
      return;
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'infiniteammo',
      enabled: Boolean(module.on),
      fireWhileReload: boolOf(module, 'Fire While Reload', true),
      autoReload: boolOf(module, 'Auto Reload', true)
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
    name: 'InfiniteAmmo',
    desc: 'Allows firing while reloading and auto-reloads when the magazine is not full.',
    cat: 'Combat',
    nm: { l: 'infiniteammo', ls: 'infinite ammo', n: 'InfiniteAmmo', ns: 'Infinite Ammo' },
    disp: '',
    settings: [
      { t: 'b', n: 'Fire While Reload', d: 'Allows firing weapons during reload.', v: 1 },
      { t: 'b', n: 'Auto Reload', d: 'Automatically reloads whenever the magazine is not full.', v: 1 }
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
    let enabled = false;
    let fireWhileReload = true;
    let autoReload = true;

    function isFireHeld(input) {
      if (!input) {
        return false;
      }

      if (typeof input.any === 'function') {
        return Boolean(input.any(['Mouse0']));
      }

      return Boolean(input.keys?.has('Mouse0'));
    }

    function applyCombatRules() {
      const debug = bridge.getGH()?.debug;
      const state = debug?.arsenal;
      const player = debug?.player;
      const slot = state?.slot;
      const def = slot?.def;

      if (!state || !slot || !def || !player?.alive || player.mode === 'mantle') {
        return;
      }

      const fireHeld = isFireHeld(debug.input);

      if (
        fireWhileReload &&
        state.state === 'reload' &&
        slot.ammo > 0 &&
        Number(state.cool) <= 0 &&
        Number(state.sprintLock) <= 0 &&
        Number(state.pumpWait) <= 0 &&
        typeof state._fire === 'function'
      ) {
        const wantsFire = def.auto ? fireHeld : Number(state.semiBuf) > 0;

        if (wantsFire) {
          const ads = Number(state.ads) || 0;
          const adsSmooth = ads * ads * (3 - 2 * ads);

          state.semiBuf = 0;
          state.wantStopReload = false;
          state._fire(slot, def, adsSmooth);
        }
      }

      if (
        autoReload &&
        state.state === 'ready' &&
        Number(state.pumpWait) <= 0 &&
        slot.ammo < def.mag &&
        slot.reserve > 0 &&
        typeof state.startReload === 'function'
      ) {
        if (fireWhileReload || (!fireHeld && Number(state.semiBuf) <= 0)) {
          state.startReload();
        }
      }
    }

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type !== 'config' || data.module !== 'infiniteammo') {
        return;
      }

      enabled = Boolean(data.enabled);
      fireWhileReload = data.fireWhileReload !== false;
      autoReload = data.autoReload !== false;
    });

    bridge.onAfterArsenalUpdate(() => {
      if (enabled) {
        applyCombatRules();
      }
    }, 45);
  }
})();
