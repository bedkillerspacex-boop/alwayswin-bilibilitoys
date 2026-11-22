(() => {
  'use strict';

  /* Speed：把移动输入按倍率放大（原版 world.move 读的就是 forward/right），
     同时顺手把玩家/武器上的速度系数一并顶住。
     只在本地生效，别人看到的还是正常速度。 */

  /* 注意：游戏页会提前 return，所以游戏侧用到的常量必须声明在判定之前 */
  const SPEED_FIELDS = ['speedMul', 'moveMul', 'runMul', 'sprintMul', 'moveSpeed', 'walkSpeed', 'speedK', 'moveK'];

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

  function value(module, name, fallback) {
    const setting = module.settings.find((entry) => entry.n === name);
    const raw = setting ? setting.v : fallback;
    const num = Number(raw);
    return Number.isFinite(num) ? num : fallback;
  }

  function syncConfig() {
    const module = getMod('Speed');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const modeSetting = module.settings.find((s) => s.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] === 'LegitHop' ? 'LegitHop' : 'Vanilla';
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'speed',
      enabled: Boolean(module.on),
      mode,
      multiplier: value(module, 'Multiplier', 1.35),
      input: Boolean((module.settings.find((s) => s.n === 'Scale Input') || { v: 1 }).v)
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
    name: 'Speed',
    desc: 'Moves you faster by scaling the movement input.',
    cat: 'Movement',
    nm: { l: 'speed', ls: 'speed', n: 'Speed', ns: 'Speed' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'Vanilla scales speed; LegitHop simulates holding Space while moving.', v: 0, vals: ['Vanilla', 'LegitHop'] },
      { t: 'n', n: 'Multiplier', d: 'Movement speed multiplier.', v: 1.35, min: 1.0, max: 4.0, step: 0.05 },
      { t: 'b', n: 'Scale Input', d: 'Scales forward/right. Turn off if the game clamps it.', v: 1 },
      { t: 'b', n: 'Boost Fields', d: 'Also pins player speed multipliers.', v: 1 }
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
    let mode = 'Vanilla';
    let multiplier = 1.35;
    let scaleInput = true;
    let boostFields = true;
    let pendingRestore = null;
    let syntheticSpace = false;
    let hopPressed = false;

    function releaseSpace() {
      hopPressed = false;

      if (!syntheticSpace) {
        return;
      }

      syntheticSpace = false;

      if (bridge.physicalSpace) {
        return;
      }

      const input = bridge.getGH()?.debug?.input;
      input?.keys?.delete('Space');
      input?.down?.delete('Space');
      input?.touchDown?.delete('Space');
    }

    function player() {
      return bridge.getGH()?.debug?.player;
    }

    function restoreInput() {
      if (!pendingRestore) {
        return;
      }

      const { input, forward, right } = pendingRestore;
      pendingRestore = null;

      if (input) {
        const scaledForward = forward * multiplier;
        const scaledRight = right * multiplier;

        if (Math.abs(input.forward - scaledForward) < 1e-9) input.forward = forward;
        if (Math.abs(input.right - scaledRight) < 1e-9) input.right = right;
      }
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'speed') {
        return;
      }

      enabled = Boolean(data.enabled);
      mode = data.mode === 'LegitHop' ? 'LegitHop' : 'Vanilla';
      multiplier = Math.max(1, Math.min(4, Number(data.multiplier) || 1.35));
      scaleInput = data.input !== false;
      boostFields = true;

      if (!enabled || mode !== 'LegitHop') {
        releaseSpace();
      }

      if (!enabled || mode === 'LegitHop') {
        restoreInput();
      }
    });

    bridge.onWorldMove((context) => {
      if (!enabled || mode === 'LegitHop' || !scaleInput || !context?.input) {
        return;
      }

      const input = context.input;
      const forward = Number(input.forward) || 0;
      const right = Number(input.right) || 0;

      if (!forward && !right) {
        return;
      }

      input.forward = forward * multiplier;
      input.right = right * multiplier;

      if (context.localInput === context.input) {
        context.localInput = { ...context.input };
      }

      pendingRestore = { input, forward, right };
      queueMicrotask(restoreInput);
    }, 15);

    bridge.onBeforePlayerUpdate(() => {
      if (!enabled) {
        releaseSpace();
        return;
      }

      if (mode === 'LegitHop') {
        const debug = bridge.getGH()?.debug;
        const input = debug?.input;
        const target = debug?.player;
        const touchForward = Number(input?.touchForward) || 0;
        const touchRight = Number(input?.touchRight) || 0;
        const moving = Boolean(
          bridge.physicalW ||
          bridge.physicalA ||
          bridge.physicalS ||
          bridge.physicalD ||
          input?.keys?.has('KeyW') ||
          input?.keys?.has('KeyA') ||
          input?.keys?.has('KeyS') ||
          input?.keys?.has('KeyD') ||
          input?.keys?.has('ArrowUp') ||
          input?.keys?.has('ArrowDown') ||
          input?.keys?.has('ArrowLeft') ||
          input?.keys?.has('ArrowRight') ||
          Math.abs(touchForward) > 0.1 ||
          Math.abs(touchRight) > 0.1
        );

        if (!input?.keys || !target?.alive || !moving || bridge.uiOpen) {
          releaseSpace();
          return;
        }

        const online = document.body.classList.contains('online-session');

        if (!target.e?.onGround || hopPressed || (online && bridge.latestOnlineJumpHeld)) {
          if (!bridge.physicalSpace) {
            input.keys.delete('Space');
            input.down?.delete('Space');
            input.touchDown?.delete('Space');
          }

          hopPressed = false;
          syntheticSpace = false;
          return;
        }

        input.keys.add('Space');
        input.down?.add('Space');
        input.touchDown?.add('Space');
        hopPressed = true;
        syntheticSpace = true;
        return;
      }

      if (!boostFields) {
        return;
      }

      const target = player();

      if (!target) {
        return;
      }

      for (const name of SPEED_FIELDS) {
        const current = target[name];

        if (typeof current === 'number' && Number.isFinite(current) && current > 0 && current < 8) {
          target[name] = Math.max(current, multiplier);
        }
      }


    }, 40);

    bridge.onReset(() => {
      pendingRestore = null;
      releaseSpace();
    });
  }
})();
