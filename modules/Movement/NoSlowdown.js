(() => {
  'use strict';

  /* NoSlowdown：开枪 / 换弹 / 跳跃落地 / 开镜时保持满速移动。
     同时覆盖：
     1. arsenal.blocksSprint（sinceFire / adsHeld / melee / throw）与 sprintLock / moveSlow
     2. player.update 前的 player.landSlow、player.adsK 与武器 def.mobility
     3. 联机 World.prototype.move 本地预测的 ADS 减速位（buttons & 8） */

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-movement';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 80;
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

  function syncConfig() {
    const module = getMod('NoSlowdown');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'noslowdown',
      enabled: Boolean(module.on),
      sprintLock: Boolean((module.settings.find((s) => s.n === 'No Sprint Lock') || { v: 1 }).v),
      fireSlow: Boolean((module.settings.find((s) => s.n === 'No Fire Slow') || { v: 1 }).v),
      adsSlow: Boolean((module.settings.find((s) => s.n === 'No Ads Slow') || { v: 0 }).v)
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
    name: 'NoSlowdown',
    desc: 'Keeps full movement speed while shooting, reloading, jumping, and scoping.',
    cat: 'Movement',
    nm: { l: 'noslowdown', ls: 'no slowdown', n: 'NoSlowdown', ns: 'No Slowdown' },
    disp: '',
    settings: [
      { t: 'b', n: 'No Sprint Lock', d: 'Clears sprint lock, landing slow, and weapon mobility penalty.', v: 1 },
      { t: 'b', n: 'No Fire Slow', d: 'Firing no longer blocks sprinting.', v: 1 },
      { t: 'b', n: 'No Ads Slow', d: 'Aiming down sights keeps full sprinting/walking speed.', v: 0 }
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
    const ADS_BUTTON = 8;
    const originalMobility = new WeakMap();

    let enabled = false;
    let noSprintLock = true;
    let noFireSlow = true;
    let noAdsSlow = false;
    let patchedBlocksSprint = null;

    function arsenal() {
      return bridge.getGH()?.debug?.arsenal;
    }

    function restoreAllMobility() {
      const current = arsenal();

      if (!current?.slots) {
        return;
      }

      for (const slot of current.slots) {
        const def = slot?.def;

        if (def && originalMobility.has(def)) {
          def.mobility = originalMobility.get(def);
        }
      }
    }

    function clearSlowdownState() {
      const debug = bridge.getGH()?.debug;
      const current = debug?.arsenal;
      const player = debug?.player;

      if (current) {
        if (noSprintLock) {
          if (Number(current.sprintLock)) {
            current.sprintLock = 0;
          }

          for (const name of ['moveSlow', 'moveSlowdown', 'slowK', 'walkSlow']) {
            if (typeof current[name] === 'number' && current[name] > 0) {
              current[name] = 0;
            }
          }

          const def = current.slot?.def;

          if (def && typeof def.mobility === 'number') {
            if (!originalMobility.has(def)) {
              originalMobility.set(def, def.mobility);
            }

            if (def.mobility < 1) {
              def.mobility = 1;
            }
          }
        }
      }

      if (player) {
        if (noSprintLock && typeof player.landSlow === 'number' && player.landSlow > 0) {
          player.landSlow = 0;
        }

        if (noAdsSlow) {
          if (typeof player.adsK === 'number' && player.adsK > 0) player.adsK = 0;
          if (typeof player.slowK === 'number' && player.slowK > 0) player.slowK = 0;
        }
      }
    }

    /* 把 blocksSprint 里所有阻止冲刺的条件绕过去 */
    function patchBlocksSprint() {
      const current = arsenal();

      if (!current || typeof current.blocksSprint !== 'function') {
        return;
      }

      if (current.blocksSprint.__solsticeNoSlowdown) {
        patchedBlocksSprint = current;
        return;
      }

      const original = current.blocksSprint;
      const wrapped = function wrappedNoSlowdownBlocksSprint(...args) {
        if (enabled) {
          const sinceFire = this.sinceFire;
          const adsHeld = this.adsHeld;
          const state = this.state;

          if (noFireSlow) {
            this.sinceFire = 999;
          }

          if (noAdsSlow) {
            this.adsHeld = false;
          }

          if (noSprintLock && (state === 'melee' || state === 'throw')) {
            this.state = 'ready';
          }

          try {
            return original.apply(this, args);
          } finally {
            this.sinceFire = sinceFire;
            this.adsHeld = adsHeld;
            this.state = state;
          }
        }

        return original.apply(this, args);
      };

      Object.defineProperty(wrapped, '__solsticeNoSlowdown', { value: true });
      current.blocksSprint = wrapped;
      patchedBlocksSprint = current;
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'noslowdown') {
        return;
      }

      enabled = Boolean(data.enabled);
      noSprintLock = data.sprintLock !== false;
      noFireSlow = data.fireSlow !== false;
      noAdsSlow = Boolean(data.adsSlow);

      if (enabled) {
        patchBlocksSprint();
        if (!noSprintLock) {
          restoreAllMobility();
        }
      } else {
        restoreAllMobility();
      }
    });

    bridge.onPlayerUpdate(() => {
      if (enabled) {
        patchBlocksSprint();
        clearSlowdownState();
      }
    }, 25);

    bridge.onAfterArsenalUpdate(() => {
      if (enabled) {
        clearSlowdownState();
      }
    }, 25);

    bridge.onWorldMove((context) => {
      if (!enabled || !noAdsSlow || !context?.localInput || !(context.localInput.buttons & ADS_BUTTON)) {
        return;
      }

      if (context.localInput === context.input) {
        context.localInput = { ...context.input };
      }

      context.localInput.buttons &= ~ADS_BUTTON;
    }, 25);

    setInterval(() => {
      if (enabled && patchedBlocksSprint !== arsenal()) {
        patchBlocksSprint();
      }
    }, 500);
  }
})();
