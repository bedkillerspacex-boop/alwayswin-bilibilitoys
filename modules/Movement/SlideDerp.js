(() => {
  'use strict';

  /* SlideDerp：
     1. 仅在交战/开火时启用（Aura 有目标、按住开火键或 sinceFire < 0.25）
     2. 在 SPRINT|SLIDE 与 SPRINT 之间切换（不强塞 CROUCH，避免 2.7 蹲伏减速）
     3. 按 input.seq 去重计数，避免 snapshot 重放时重复触发
     4. 通过 bridge.provide('slidederp') 暴露服务端眼高，供 Aura 修正 Silent 下的爆头 pitch */

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
      silent: Boolean(setting(module, 'Silent', true)),
      onlyForward: Boolean(setting(module, 'Only Forward', true))
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
    desc: 'Toggles slide/sprint while fighting without crouch slowdown.',
    cat: 'Movement',
    nm: { l: 'slidederp', ls: 'slide derp', n: 'SlideDerp', ns: 'Slide Derp' },
    disp: 'Interval',
    settings: [
      { t: 'n', n: 'Interval', d: 'Ticks between slide and sprint toggles.', v: 2, min: 1, max: 20, step: 1 },
      { t: 'b', n: 'Silent', d: 'Applies slide derp only to server input.', v: 1 },
      { t: 'b', n: 'Only Forward', d: 'Only triggers SlideDerp while moving forward.', v: 1 }
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
    let onlyForward = true;
    let tickCount = 0;
    let lastSeq = -1;
    let activeNow = false;
    let serverSliding = false;
    const seqPhaseMap = new Map();

    function isFighting() {
      const aura = typeof bridge.getFeature === 'function' ? bridge.getFeature('aura') : null;

      if (aura && typeof aura.getTarget === 'function' && aura.getTarget()) {
        return true;
      }

      const debug = bridge.getGH()?.debug;
      const input = debug?.input;
      const fireHeld =
        typeof input?.any === 'function'
          ? Boolean(input.any(['Mouse0']))
          : Boolean(input?.keys?.has('Mouse0'));

      if (fireHeld || bridge.physicalLmb) {
        return true;
      }

      return Number(debug?.arsenal?.sinceFire) < 0.25;
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'slidederp') {
        return;
      }

      enabled = Boolean(data.enabled);
      interval = Math.max(1, Math.min(20, Math.round(Number(data.interval) || 2)));
      silent = data.silent !== false;
      onlyForward = data.onlyForward !== false;

      if (!enabled) {
        tickCount = 0;
        lastSeq = -1;
        activeNow = false;
        serverSliding = false;
        seqPhaseMap.clear();
      }
    });

    bridge.onWorldMove((context) => {
      if (!enabled || !context?.input) {
        activeNow = false;
        serverSliding = false;
        return;
      }

      const input = context.input;
      const forward = Number(input.forward) || 0;
      const right = Number(input.right) || 0;
      const moving = onlyForward ? forward > 0.01 : Math.abs(forward) > 0.01 || Math.abs(right) > 0.01;

      if (!moving || !isFighting()) {
        activeNow = false;
        serverSliding = false;
        return;
      }

      activeNow = true;
      const seq = Number(input.seq);
      let phase;

      if (Number.isFinite(seq) && seqPhaseMap.has(seq)) {
        phase = seqPhaseMap.get(seq);
      } else {
        if (!Number.isFinite(seq) || seq > lastSeq) {
          tickCount += 1;
          if (Number.isFinite(seq)) {
            lastSeq = seq;
          }
        }

        phase = Math.floor(tickCount / interval) % 2;

        if (Number.isFinite(seq)) {
          seqPhaseMap.set(seq, phase);
          if (seqPhaseMap.size > 160) {
            const firstKey = seqPhaseMap.keys().next().value;
            seqPhaseMap.delete(firstKey);
          }
        }
      }

      if (silent && context.localInput === context.input) {
        context.localInput = { ...context.input };
      }

      if (phase === 0) {
        input.buttons = (input.buttons | SPRINT | SLIDE) & ~CROUCH;
        serverSliding = true;
      } else {
        input.buttons = (input.buttons | SPRINT) & ~(SLIDE | CROUCH);
        serverSliding = false;
      }

      if (!silent) {
        context.localInput.buttons = input.buttons;
      }

      const m = context.motionState;

      if (m && m.sliding) {
        const horiz = Math.hypot(m.vx || 0, m.vz || 0);

        if (horiz > 0.1 && horiz < 7.5) {
          const scale = 7.5 / horiz;
          m.vx *= scale;
          m.vz *= scale;
        }
      }
    }, 15);

    if (typeof bridge.provide === 'function') {
      bridge.provide('slidederp', {
        isActive: () => enabled && activeNow,
        isSilent: () => silent,
        getServerEyeHeight: () => (serverSliding ? 0.72 : 1.62)
      });
    }

    bridge.onReset(() => {
      tickCount = 0;
      lastSeq = -1;
      activeNow = false;
      serverSliding = false;
      seqPhaseMap.clear();
    });
  }
})();
