(() => {
  'use strict';

  /* InfiniteAmmo：
     1. 换弹时允许开火（Fire While Reload）：在 arsenal.update() 推进换弹进度后，若处于 reload 状态且满足开火条件则直接调用 _fire()
     2. 子弹不满时自动换弹（Auto Reload）：处于 ready 状态且 slot.ammo < slot.def.mag 时自动触发 startReload()
     3. Patch 联机同步（client/engine.js）：
        - 拦截 net.send({ type: 'reload' })，不让服务端进入换弹禁开火状态
        - 在 Engine.prototype.snapshot() 后保护本地 slot.ammo / slot.reserve 与 reload 状态不被服务端快照覆写 */

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
      autoReload: boolOf(module, 'Auto Reload', true),
      patchSync: boolOf(module, 'Patch Sync', true)
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
    desc: 'Allows firing while reloading, auto-reloads when not full, and patches online sync to bypass reload/ammo locks.',
    cat: 'Combat',
    nm: { l: 'infiniteammo', ls: 'infinite ammo', n: 'InfiniteAmmo', ns: 'Infinite Ammo' },
    disp: '',
    settings: [
      { t: 'b', n: 'Fire While Reload', d: 'Allows firing weapons during reload.', v: 1 },
      { t: 'b', n: 'Auto Reload', d: 'Automatically reloads whenever the magazine is not full.', v: 1 },
      { t: 'b', n: 'Patch Sync', d: 'Blocks reload packets and preserves local ammo/reload state across server snapshots.', v: 1 }
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
    let patchSync = true;
    let enginePatched = false;

    function isFireHeld(input) {
      if (!input) {
        return false;
      }

      if (typeof input.any === 'function') {
        return Boolean(input.any(['Mouse0']));
      }

      return Boolean(input.keys?.has('Mouse0'));
    }

    function patchNetSend(engine) {
      const net = engine?.net;

      if (!net || typeof net.send !== 'function' || net.send.__solsticeReloadBlocked) {
        return;
      }

      const originalSend = net.send;
      const wrappedSend = function wrappedSolsticeNetSend(msg, ...rest) {
        if (enabled && patchSync && msg && msg.type === 'reload') {
          return Promise.resolve();
        }

        return originalSend.call(this, msg, ...rest);
      };

      Object.defineProperty(wrappedSend, '__solsticeReloadBlocked', { value: true });
      net.send = wrappedSend;
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

          if (!proto || typeof proto.snapshot !== 'function' || proto.snapshot.__solsticeAmmoSyncPatched) {
            return;
          }

          const originalSnapshot = proto.snapshot;
          const wrappedSnapshot = function wrappedSolsticeSnapshot(...args) {
            patchNetSend(this);

            if (!enabled || !patchSync) {
              return originalSnapshot.apply(this, args);
            }

            const ars = this.ctx?.arsenal;
            const slot = ars?.slot;
            const saved = ars
              ? {
                  state: ars.state,
                  clip: ars.clip,
                  clipName: ars.clipName,
                  clipT: ars.clipT,
                  clipDur: ars.clipDur,
                  evI: ars.evI,
                  loaded: ars.loaded,
                  slot,
                  ammo: slot ? slot.ammo : undefined,
                  reserve: slot ? slot.reserve : undefined
                }
              : null;

            const result = originalSnapshot.apply(this, args);

            if (saved && this.ctx?.arsenal === ars) {
              if (saved.slot && ars.slot === saved.slot) {
                if (saved.ammo !== undefined) {
                  saved.slot.ammo = saved.ammo;
                }

                if (saved.reserve !== undefined) {
                  saved.slot.reserve = saved.reserve;
                }
              }

              if (saved.state === 'reload' && ars.state !== 'reload') {
                ars.state = saved.state;
                ars.clip = saved.clip;
                ars.clipName = saved.clipName;
                ars.clipT = saved.clipT;
                ars.clipDur = saved.clipDur;
                ars.evI = saved.evI;
                ars.loaded = saved.loaded;
              }
            }

            return result;
          };

          Object.defineProperty(wrappedSnapshot, '__solsticeAmmoSyncPatched', { value: true });
          proto.snapshot = wrappedSnapshot;
        })
        .catch(() => {
          enginePatched = false;
        });
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
      patchSync = data.patchSync !== false;

      if (enabled) {
        installEnginePatch();
      }
    });

    bridge.onAfterArsenalUpdate(() => {
      if (enabled) {
        applyCombatRules();
      }
    }, 45);
  }
})();
