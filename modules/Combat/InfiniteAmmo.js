(() => {
  'use strict';

  /* InfiniteAmmo：
     - 单机训练模式（非 PvP）：直接锁定 slot.ammo = def.mag、slot.reserve = def.reserve 并取消换弹/泵动硬直，实现真无限子弹。
     - 联机 PvP 模式（engine.js 接管了 startReload）：服务端权威校验 me.ammo 与 me.reload > 0，
       强改本地弹匣会导致空包弹/无伤害，因此自动切换为「停火后自动换弹」（不打断连射，停火即补满）。 */

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 400;
  const AUTO_RELOAD_IDLE_SEC = 0.3;

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
      infiniteMag: boolOf(module, 'Infinite Mag', true),
      noReload: boolOf(module, 'No Reload', true),
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
    desc: 'True infinite ammo offline; smart auto-reload after firing in PvP.',
    cat: 'Combat',
    nm: { l: 'infiniteammo', ls: 'infinite ammo', n: 'InfiniteAmmo', ns: 'Infinite Ammo' },
    disp: '',
    settings: [
      { t: 'b', n: 'Infinite Mag', d: 'Keeps magazine and reserve full (offline/training only).', v: 1 },
      { t: 'b', n: 'No Reload', d: 'Skips reload and pump wait (offline/training only).', v: 1 },
      { t: 'b', n: 'Auto Reload', d: 'Auto-reloads when ammo is not full after you stop firing.', v: 1 }
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
    let infiniteMag = true;
    let noReload = true;
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

    function isOnlinePvP(state) {
      const proto = Object.getPrototypeOf(state);
      return Boolean(proto && typeof proto.startReload === 'function' && state.startReload !== proto.startReload);
    }

    function applyOfflineInfinite(state, slot, def) {
      const mag = Number(def.mag) || 0;
      const reserve = Number(def.reserve) || 0;

      if (infiniteMag) {
        if (mag > 0 && slot.ammo < mag) {
          slot.ammo = mag;
        }

        if (reserve > 0 && slot.reserve < reserve) {
          slot.reserve = reserve;
        }
      }

      if (noReload) {
        if (state.state === 'reload') {
          state.state = 'ready';
          state.clip = null;
        }

        if (Number(state.pumpWait) > 0) {
          state.pumpWait = 0;
        }
      }
    }

    function applyAutoReload(state, slot, def, input) {
      if (
        !autoReload ||
        state.state !== 'ready' ||
        Number(state.pumpWait) > 0 ||
        slot.ammo >= def.mag ||
        slot.reserve <= 0 ||
        typeof state.startReload !== 'function'
      ) {
        return;
      }

      const fireHeld = isFireHeld(input);

      if (!fireHeld && Number(state.semiBuf) <= 0 && Number(state.sinceFire) >= AUTO_RELOAD_IDLE_SEC) {
        state.startReload();
      }
    }

    function applyAmmo(isAfter) {
      const debug = bridge.getGH()?.debug;
      const state = debug?.arsenal;
      const player = debug?.player;
      const slot = state?.slot;
      const def = slot?.def;

      if (!state || !slot || !def) {
        return;
      }

      if (!isOnlinePvP(state)) {
        applyOfflineInfinite(state, slot, def);
        return;
      }

      if (isAfter && player?.alive && player.mode !== 'mantle') {
        applyAutoReload(state, slot, def, debug.input);
      }
    }

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type !== 'config' || data.module !== 'infiniteammo') {
        return;
      }

      enabled = Boolean(data.enabled);
      infiniteMag = data.infiniteMag !== false;
      noReload = data.noReload !== false;
      autoReload = data.autoReload !== false;
    });

    bridge.onBeforeArsenalUpdate(() => {
      if (enabled) {
        applyAmmo(false);
      }
    }, 45);

    bridge.onAfterArsenalUpdate(() => {
      if (enabled) {
        applyAmmo(true);
      }
    }, 45);
  }
})();
