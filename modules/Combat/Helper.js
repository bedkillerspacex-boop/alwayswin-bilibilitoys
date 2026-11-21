(() => {
  'use strict';

  /* Helper：
     1. 主武器打空且未在换弹时，自动切到副武器补枪
     2. 手持副武器时，仅在周围没有可攻击敌人（或副武器打空）且未在换弹时才切回主武器，避免对群杀一个就切回
     3. 主/副武器换弹中绝不打断，且换弹完成后等待 0.3s 才允许切枪；每次切枪带 0.4s 冷却防重复换弹
     4. 可选「Fire While Swap」（默认关）：切枪（holster/draw）期间仍允许开火 */

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
    const module = getMod('Helper');

    if (!module) {
      return;
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'helper',
      enabled: Boolean(module.on),
      autoSecondary: boolOf(module, 'Auto Secondary', true),
      returnOnKill: boolOf(module, 'Return On Kill', true),
      returnWhenIdle: boolOf(module, 'Return When Idle', true),
      fireWhileSwap: boolOf(module, 'Fire While Swap', false)
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
    name: 'Helper',
    desc: 'Swaps to secondary when primary runs out, returns when no enemies remain, and optionally fires while swapping.',
    cat: 'Combat',
    nm: { l: 'helper', ls: 'helper', n: 'Helper', ns: 'Helper' },
    disp: '',
    settings: [
      { t: 'b', n: 'Auto Secondary', d: 'Swaps to secondary when primary ammo reaches 0.', v: 1 },
      { t: 'b', n: 'Return On Kill', d: 'Swaps back to primary after kills once no enemies remain.', v: 1 },
      { t: 'b', n: 'Return When Idle', d: 'Swaps back to primary when idle and no enemies remain.', v: 1 },
      { t: 'b', n: 'Fire While Swap', d: 'Allows firing during holster/draw swap animations.', v: 0 }
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
    const SWAPPABLE_STATES = new Set(['ready', 'inspect', 'draw']);
    const RELOAD_GRACE_MS = 300;
    const SWAP_COOLDOWN_MS = 400;
    const IDLE_RETURN_DELAY_MS = 500;
    const IDLE_SINCE_FIRE_SEC = 0.5;
    const ENEMY_CHECK_RANGE = 30;

    let enabled = false;
    let autoSecondary = true;
    let returnOnKill = true;
    let returnWhenIdle = true;
    let fireWhileSwap = false;

    let lastKills = null;
    let lastArsenalState = null;
    let reloadGraceUntil = 0;
    let swapCooldownUntil = 0;
    let primaryEmptyHandled = false;
    let pendingReturnToPrimary = false;
    let swappedToSecondaryAt = 0;

    function resetTracking() {
      lastKills = null;
      lastArsenalState = null;
      reloadGraceUntil = 0;
      swapCooldownUntil = 0;
      primaryEmptyHandled = false;
      pendingReturnToPrimary = false;
      swappedToSecondaryAt = 0;
    }

    function isFireHeld(debug) {
      const input = debug?.input;

      if (!input) {
        return false;
      }

      if (typeof input.any === 'function') {
        return Boolean(input.any(['Mouse0']));
      }

      return Boolean(input.keys?.has('Mouse0'));
    }

    function isFiring(debug, state) {
      return isFireHeld(debug) || Boolean(state.triggerDown) || Number(state.semiBuf) > 0;
    }

    function hasActiveEnemy(debug, player) {
      const aura = typeof bridge.getFeature === 'function' ? bridge.getFeature('aura') : null;

      if (aura && typeof aura.getTarget === 'function' && aura.getTarget()) {
        return true;
      }

      const actors = debug?.match?.actors;
      const eye = player?.eye || debug?.gfx?.camera?.position;

      if (!Array.isArray(actors) || !eye) {
        return false;
      }

      const point = player.pos.clone();

      for (const actor of actors) {
        if (!bridge.isEnemy(actor, player)) {
          continue;
        }

        bridge.headPoint(actor, point);
        const dist = Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z);

        if (dist <= ENEMY_CHECK_RANGE && bridge.worldLineClear(eye, point)) {
          return true;
        }
      }

      return false;
    }

    function tryFireWhileSwap(debug, state, player) {
      if (!fireWhileSwap || (state.state !== 'holster' && state.state !== 'draw')) {
        return;
      }

      const slot = state.slot;
      const def = slot?.def;

      if (
        !slot ||
        !def ||
        !player?.alive ||
        player.mode === 'mantle' ||
        slot.ammo <= 0 ||
        Number(state.cool) > 0 ||
        Number(state.sprintLock) > 0 ||
        Number(state.pumpWait) > 0 ||
        typeof state._fire !== 'function'
      ) {
        return;
      }

      const wantsFire = def.auto ? isFireHeld(debug) : Number(state.semiBuf) > 0;

      if (!wantsFire) {
        return;
      }

      const ads = Number(state.ads) || 0;
      const adsSmooth = ads * ads * (3 - 2 * ads);
      state.semiBuf = 0;
      state._fire(slot, def, adsSmooth);
    }

    function updateHelper() {
      const debug = bridge.getGH()?.debug;
      const state = debug?.arsenal;
      const player = debug?.player;

      if (!state || !player) {
        return;
      }

      const now = performance.now();

      if (lastArsenalState === 'reload' && state.state !== 'reload') {
        reloadGraceUntil = now + RELOAD_GRACE_MS;
      }

      lastArsenalState = state.state;

      tryFireWhileSwap(debug, state, player);

      const kills = Number(player.kills) || 0;

      if (!player.alive) {
        lastKills = kills;
        reloadGraceUntil = 0;
        swapCooldownUntil = 0;
        primaryEmptyHandled = false;
        pendingReturnToPrimary = false;
        swappedToSecondaryAt = 0;
        return;
      }

      if (lastKills === null) {
        lastKills = kills;
      }

      const scoredKill = kills > lastKills;
      lastKills = kills;

      if (state.cur === 0) {
        pendingReturnToPrimary = false;
      } else if (returnOnKill && scoredKill && state.cur === 1) {
        pendingReturnToPrimary = true;
      }

      const primary = state.slots?.[0];
      const secondary = state.slots?.[1];
      const primaryAmmo = Number(primary?.ammo) || 0;
      const secondaryAmmo = Number(secondary?.ammo) || 0;

      if (primaryAmmo > 0) {
        primaryEmptyHandled = false;
      }

      if (
        state.state === 'reload' ||
        state.state === 'holster' ||
        now < reloadGraceUntil ||
        now < swapCooldownUntil ||
        !SWAPPABLE_STATES.has(state.state) ||
        typeof state.swap !== 'function'
      ) {
        return;
      }

      if (state.cur === 1 && primary) {
        const enemyLeft = secondaryAmmo > 0 && hasActiveEnemy(debug, player);

        if (pendingReturnToPrimary && !enemyLeft) {
          pendingReturnToPrimary = false;
          swapCooldownUntil = now + SWAP_COOLDOWN_MS;
          state.swap(0);
          return;
        }

        if (returnWhenIdle && !enemyLeft) {
          const firing = isFiring(debug, state);
          const sinceFire = Number(state.sinceFire) || 0;

          if (firing) {
            swappedToSecondaryAt = now;
          } else if (now - swappedToSecondaryAt >= IDLE_RETURN_DELAY_MS && sinceFire >= IDLE_SINCE_FIRE_SEC) {
            swapCooldownUntil = now + SWAP_COOLDOWN_MS;
            state.swap(0);
            return;
          }
        }
      }

      if (
        autoSecondary &&
        !primaryEmptyHandled &&
        state.cur === 0 &&
        primary &&
        primaryAmmo <= 0 &&
        secondaryAmmo > 0
      ) {
        primaryEmptyHandled = true;
        swappedToSecondaryAt = now;
        swapCooldownUntil = now + SWAP_COOLDOWN_MS;
        state.swap(1);
      }
    }

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type !== 'config' || data.module !== 'helper') {
        return;
      }

      const nextEnabled = Boolean(data.enabled);

      if (nextEnabled !== enabled) {
        resetTracking();
      }

      enabled = nextEnabled;
      autoSecondary = data.autoSecondary !== false;
      returnOnKill = data.returnOnKill !== false;
      returnWhenIdle = data.returnWhenIdle !== false;
      fireWhileSwap = Boolean(data.fireWhileSwap);
    });

    bridge.onAfterArsenalUpdate(() => {
      if (enabled) {
        updateHelper();
      }
    }, 45);

    bridge.onReset(() => {
      resetTracking();
    });
  }
})();
