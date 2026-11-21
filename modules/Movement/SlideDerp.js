(() => {
  'use strict';

  /* SlideDerp：按固定 tick 间隔在「滑铲（SLIDE）」与「站立/取消滑铲（CROUCH/STAND）」之间高速切换，
     配合 bhop / Speed 使用时，使服务端与敌方视角中的角色高度（0.95 / 1.2 / 1.8）和速度不断抖动，降低被命中率。 */

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

  function setting(module, name, fallback) {
    const entry = module.settings.find((s) => s.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig() {
    const module = getMod('SlideDerp');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const interval = Math.max(1, Math.min(20, Math.round(Number(setting(module, 'Interval', 2)) || 2)));
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'slidederp',
      enabled: Boolean(module.on),
      interval,
      silent: Boolean(setting(module, 'Silent', true))
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
    name: 'SlideDerp',
    desc: 'Rapidly toggles slide and stand/crouch states to desync enemy/bot aim while bhopping.',
    cat: 'Movement',
    nm: { l: 'slidederp', ls: 'slide derp', n: 'SlideDerp', ns: 'Slide Derp' },
    disp: 'Interval',
    settings: [
      { t: 'n', n: 'Interval', d: 'Ticks between slide and un-slide toggles.', v: 2, min: 1, max: 20, step: 1 },
      { t: 'b', n: 'Silent', d: 'Applies slide derp to server input without shaking your local camera.', v: 1 }
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
    const SPRINT = 2;
    const CROUCH = 4;
    const SLIDE = 16;

    let enabled = false;
    let interval = 2;
    let silent = true;
    let tickCount = 0;

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'slidederp') {
        return;
      }

      enabled = Boolean(data.enabled);
      interval = Math.max(1, Math.min(20, Math.round(Number(data.interval) || 2)));
      silent = data.silent !== false;

      if (!enabled) {
        tickCount = 0;
      }
    });

    bridge.onWorldMove((context) => {
      if (!enabled || !context?.input) {
        return;
      }

      const input = context.input;
      const moving = Math.abs(Number(input.forward) || 0) > 0.01 || Math.abs(Number(input.right) || 0) > 0.01;

      if (!moving) {
        return;
      }

      tickCount += 1;
      const phase = Math.floor(tickCount / interval) % 2;

      if (silent && context.localInput === context.input) {
        context.localInput = { ...context.input };
      }

      if (phase === 0) {
        input.buttons = (input.buttons | SPRINT | SLIDE) & ~CROUCH;
      } else {
        input.buttons = (input.buttons | CROUCH) & ~SLIDE;
      }
    }, 15);

    bridge.onReset(() => {
      tickCount = 0;
    });
  }
})();
