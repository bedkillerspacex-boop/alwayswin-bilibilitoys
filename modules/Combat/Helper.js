(() => {
  'use strict';

  /* Helper：
     1. 主武器打空且未在换弹时，自动切到副武器补枪（绝不打断主武器换弹）
     2. 手持副武器时，击杀目标后或停止射击（Idle）时自动切回主武器
     通过 primaryEmptyHandled 防止切回主武器后因主武器仍为 0 发而反复来回切枪。 */

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
      returnWhenIdle: boolOf(module, 'Return When Idle', true)
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
    desc: 'Swaps to secondary when primary runs out (without interrupting reload), and returns to primary on kill or when idle.',
    cat: 'Combat',
    nm: { l: 'helper', ls: 'helper', n: 'Helper', ns: 'Helper' },
    disp: '',
    settings: [
      { t: 'b', n: 'Auto Secondary', d: 'Swaps to secondary when primary ammo reaches 0.', v: 1 },
      { t: 'b', n: 'Return On Kill', d: 'Swaps back to primary after scoring a kill.', v: 1 },
      { t: 'b', n: 'Return When Idle', d: 'Swaps back to primary when not firing on secondary.', v: 1 }
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
    const PRIMARY_SWAPPABLE_STATES = new Set(['ready', 'inspect', 'draw']);
    const SECONDARY_SWAPPABLE_STATES = new Set(['ready', 'reload', 'inspect', 'draw']);
    const IDLE_RETURN_DELAY_MS = 500;
    const IDLE_SINCE_FIRE_SEC = 0.5;

    let enabled = false;
    let autoSecondary = true;
    let returnOnKill = true;
    let returnWhenIdle = true;

    let lastKills = null;
    let primaryEmptyHandled = false;
    let swappedToSecondaryAt = 0;

    function resetTracking() {
      lastKills = null;
      primaryEmptyHandled = false;
      swappedToSecondaryAt = 0;
    }

    function isFiring(debug, state) {
      const input = debug?.input;
      const fireHeld =
        typeof input?.any === 'function'
          ? Boolean(input.any(['Mouse0']))
          : Boolean(input?.keys?.has('Mouse0'));

      return fireHeld || Boolean(state.triggerDown) || Number(state.semiBuf) > 0;
    }

    function updateHelper() {
      const debug = bridge.getGH()?.debug;
      const state = debug?.arsenal;
      const player = debug?.player;

      if (!state || !player) {
        return;
      }

      const kills = Number(player.kills) || 0;

      if (!player.alive) {
        lastKills = kills;
        primaryEmptyHandled = false;
        swappedToSecondaryAt = 0;
        return;
      }

      if (lastKills === null) {
        lastKills = kills;
      }

      const scoredKill = kills > lastKills;
      lastKills = kills;

      const primary = state.slots?.[0];
      const secondary = state.slots?.[1];
      const primaryAmmo = Number(primary?.ammo) || 0;
      const secondaryAmmo = Number(secondary?.ammo) || 0;

      if (primaryAmmo > 0) {
        primaryEmptyHandled = false;
      }

      if (typeof state.swap !== 'function') {
        return;
      }

      if (state.cur === 1 && primary && SECONDARY_SWAPPABLE_STATES.has(state.state)) {
        if (returnOnKill && scoredKill) {
          state.swap(0);
          return;
        }

        if (returnWhenIdle) {
          const now = performance.now();
          const firing = isFiring(debug, state);
          const sinceFire = Number(state.sinceFire) || 0;

          if (firing) {
            swappedToSecondaryAt = now;
          } else if (now - swappedToSecondaryAt >= IDLE_RETURN_DELAY_MS && sinceFire >= IDLE_SINCE_FIRE_SEC) {
            state.swap(0);
            return;
          }
        }
      }

      if (
        autoSecondary &&
        !primaryEmptyHandled &&
        state.cur === 0 &&
        state.state !== 'reload' &&
        PRIMARY_SWAPPABLE_STATES.has(state.state) &&
        primary &&
        primaryAmmo <= 0 &&
        secondaryAmmo > 0
      ) {
        primaryEmptyHandled = true;
        swappedToSecondaryAt = performance.now();
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
