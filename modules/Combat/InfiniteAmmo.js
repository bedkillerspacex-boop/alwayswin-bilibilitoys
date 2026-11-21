(() => {
  'use strict';

  /* InfiniteAmmo：
     1. 本地弹匣/备弹锁定为 def.mag / def.reserve（兜底按候选字段探测），在 arsenal.update 前后各顶一次；
     2. 通过 patch client/engine.js 的 Engine.prototype.snapshot，防止联机快照把 slot.ammo / slot.reserve 覆写成 0；
     3. No Reload 开启时拦截 startReload（避免向服务端发送 { type: "reload" } 导致服务端锁死开火），并清理 reload / pumpWait 状态。 */

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
      magazine: boolOf(module, 'Infinite Mag', true),
      reload: boolOf(module, 'No Reload', true),
      reserve: boolOf(module, 'Infinite Reserve', true)
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
    desc: 'Keeps magazine and reserve full, blocks reload packets, and prevents online snapshots from resetting ammo.',
    cat: 'Combat',
    nm: { l: 'infiniteammo', ls: 'infinite ammo', n: 'InfiniteAmmo', ns: 'Infinite Ammo' },
    disp: '',
    settings: [
      { t: 'b', n: 'Infinite Mag', d: 'Keeps the magazine full.', v: 1 },
      { t: 'b', n: 'No Reload', d: 'Blocks reload triggers and clears reload state.', v: 1 },
      { t: 'b', n: 'Infinite Reserve', d: 'Keeps reserve ammo topped up.', v: 1 }
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
    const CAPACITY_KEYS = ['capacity', 'max', 'maxAmmo', 'magSize', 'clipSize', 'size', 'mag', 'magazineSize'];
    const RESERVE_KEYS = ['reserve', 'reserveAmmo', 'ammoReserve', 'spare', 'spareAmmo', 'backup'];

    let enabled = false;
    let magazine = true;
    let noReload = true;
    let reserve = true;
    let enginePatched = false;

    function arsenal() {
      return bridge.getGH()?.debug?.arsenal;
    }

    function readCapacity(slot) {
      const defMag = Number(slot?.def?.mag);

      if (Number.isFinite(defMag) && defMag > 0 && defMag < 5000) {
        return defMag;
      }

      for (const key of CAPACITY_KEYS) {
        const value = Number(slot?.[key]);

        if (Number.isFinite(value) && value > 0 && value < 5000) {
          return value;
        }
      }

      return Number(slot?.ammo) || 0;
    }

    function patchStartReload(state) {
      if (typeof state.startReload !== 'function' || state.startReload.__solsticeInfiniteAmmoWrapped) {
        return;
      }

      const originalStartReload = state.startReload;
      const wrappedStartReload = function wrappedSolsticeStartReload(...args) {
        if (enabled && noReload) {
          return;
        }

        return originalStartReload.apply(this, args);
      };

      Object.defineProperty(wrappedStartReload, '__solsticeInfiniteAmmoWrapped', { value: true });
      state.startReload = wrappedStartReload;
    }

    function applyAmmo() {
      const state = arsenal();

      if (!state) {
        return;
      }

      patchStartReload(state);

      const slot = state.slot;

      if (!slot) {
        return;
      }

      const capacity = readCapacity(slot);

      if (magazine && capacity > 0 && Number(slot.ammo) < capacity) {
        slot.ammo = capacity;
      }

      if (reserve) {
        const defReserve = Number(slot.def?.reserve);

        if (Number.isFinite(defReserve) && defReserve > 0) {
          if (Number(slot.reserve) < defReserve) {
            slot.reserve = defReserve;
          }
        } else {
          for (const key of RESERVE_KEYS) {
            const value = Number(slot[key]);

            if (Number.isFinite(value) && value > 0) {
              slot[key] = value;
            }
          }
        }
      }

      if (noReload) {
        if (state.state === 'reload' || state.state === 'reloading') {
          state.state = 'ready';
          state.clip = null;
        }

        if (Number(state.pumpWait) > 0) {
          state.pumpWait = 0;
        }
      }
    }

    function installEnginePatch() {
      if (enginePatched) {
        return;
      }

      enginePatched = true;
      const engineUrl = new URL('client/engine.js', location.href).href;

      import(engineUrl)
        .then(({ Engine }) => {
          const proto = Engine?.prototype;

          if (!proto || typeof proto.snapshot !== 'function' || proto.snapshot.__solsticeInfiniteAmmoPatched) {
            return;
          }

          const originalSnapshot = proto.snapshot;
          const wrappedSnapshot = function wrappedSolsticeEngineSnapshot(...args) {
            const result = originalSnapshot.apply(this, args);

            if (enabled) {
              applyAmmo();
            }

            return result;
          };

          Object.defineProperty(wrappedSnapshot, '__solsticeInfiniteAmmoPatched', { value: true });
          proto.snapshot = wrappedSnapshot;
        })
        .catch(() => {
          enginePatched = false;
        });
    }

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type !== 'config' || data.module !== 'infiniteammo') {
        return;
      }

      enabled = Boolean(data.enabled);
      magazine = data.magazine !== false;
      noReload = data.reload !== false;
      reserve = data.reserve !== false;

      if (enabled) {
        installEnginePatch();
        applyAmmo();
      }
    });

    bridge.onBeforeArsenalUpdate(() => {
      if (enabled) {
        applyAmmo();
      }
    }, 45);

    bridge.onAfterArsenalUpdate(() => {
      if (enabled) {
        applyAmmo();
      }
    }, 45);

    bridge.onReset(() => {
      if (enabled) {
        applyAmmo();
      }
    });
  }
})();
