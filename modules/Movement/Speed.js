(() => {
  'use strict';

  /* Speed：
     - LegitHop：移动且落地时立即起跳，空中松开 Space 保证下一跳零延迟
     - SlideHop：利用服务端 simulation.js 滑铲机制（1.3x 加速至 9.75-11 m/s），
       在落地且冷却就绪时触发服务端滑铲加速并接跳，滑铲速度回落至 7.6 m/s 时自动蹲取消（>0.28s），
       让服务端平均速度持续高于普通疾跑（7.5 m/s） */

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
    const module = getMod('Speed');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const modeSetting = module.settings.find((s) => s.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] === 'SlideHop' ? 'SlideHop' : 'LegitHop';
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'speed',
      enabled: Boolean(module.on),
      mode
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
    desc: 'LegitHop auto-jumps on ground; SlideHop chains server 1.3x slide boosts + cancels for real server speed.',
    cat: 'Movement',
    nm: { l: 'speed', ls: 'speed', n: 'Speed', ns: 'Speed' },
    disp: 'Mode',
    settings: [
      {
        t: 'e',
        n: 'Mode',
        d: 'LegitHop jumps on ground contact; SlideHop chains server 9.75-11 m/s slide boosts.',
        v: 0,
        vals: ['LegitHop', 'SlideHop']
      }
    ],
    onRender: syncConfig,
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncConfig();
    }
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
    let mode = 'LegitHop';
    let syntheticSpace = false;
    let enginePatched = false;

    const serverState = {
      ground: true,
      sliding: false,
      crouch: false,
      slideTime: 0,
      slideCooldown: 0,
      speed: 0
    };

    function releaseSpace() {
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

    function patchNetInput(engine) {
      const net = engine?.net;

      if (!net || typeof net.input !== 'function' || net.input.__solsticeSpeedPatched) {
        return;
      }

      const originalInput = net.input;
      const wrappedInput = function wrappedSpeedInput(input, ...rest) {
        if (enabled && mode === 'SlideHop' && input) {
          const moving = Math.hypot(Number(input.forward) || 0, Number(input.right) || 0) > 0.01;
          let buttons = input.buttons | 0;

          if (moving && !(buttons & 8)) {
            buttons |= 2; // SPRINT
          }

          if (!serverState.ground) {
            buttons &= ~1; // release JUMP in air so jumpHeld resets before landing
          } else if (moving) {
            if (!serverState.sliding && !serverState.crouch && serverState.slideCooldown <= 0 && serverState.speed > 5.2) {
              buttons |= 16; // trigger server 1.3x slide boost
            }

            if (serverState.sliding) {
              buttons |= 1; // hop while carrying boosted slide velocity
            }
          }

          // Cancel slide right before speed drops below sprint speed (7.5 m/s)
          if (serverState.sliding && serverState.slideTime > 0.28 && serverState.speed <= 7.6) {
            buttons |= 4; // CROUCH cancels slide cleanly and starts 0.4s cooldown early
          }

          if (buttons !== input.buttons) {
            input = { ...input, buttons };
          }
        }

        return originalInput.call(this, input, ...rest);
      };

      Object.defineProperty(wrappedInput, '__solsticeSpeedPatched', { value: true });
      net.input = wrappedInput;
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

          if (!proto || typeof proto.snapshot !== 'function' || proto.snapshot.__solsticeSpeedPatched) {
            return;
          }

          const originalSnapshot = proto.snapshot;
          const wrappedSnapshot = function wrappedSpeedSnapshot(s, ...rest) {
            patchNetInput(this);
            const me = s?.players?.find((p) => p.id === this.net?.id);

            if (me) {
              serverState.ground = Boolean(me.ground);
              serverState.sliding = Boolean(me.sliding);
              serverState.crouch = Boolean(me.crouch);
              serverState.slideTime = Number(me.slideTime) || 0;
              serverState.slideCooldown = Number(me.slideCooldown) || 0;
              serverState.speed = Math.hypot(Number(me.vx) || 0, Number(me.vz) || 0);
            }

            return originalSnapshot.call(this, s, ...rest);
          };

          Object.defineProperty(wrappedSnapshot, '__solsticeSpeedPatched', { value: true });
          proto.snapshot = wrappedSnapshot;
        })
        .catch(() => {
          enginePatched = false;
        });
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'speed') {
        return;
      }

      enabled = Boolean(data.enabled);
      mode = data.mode === 'SlideHop' ? 'SlideHop' : 'LegitHop';

      if (enabled && mode === 'SlideHop') {
        installEnginePatch();
      }

      if (!enabled || mode !== 'LegitHop') {
        releaseSpace();
      }
    });

    bridge.onBeforePlayerUpdate(() => {
      if (!enabled || mode !== 'LegitHop') {
        releaseSpace();
        return;
      }

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

      const engineState = typeof bridge.getEngineState === 'function' ? bridge.getEngineState() : null;
      const grounded = Boolean(target.e?.onGround || engineState?.predicted?.ground);

      if (!grounded) {
        if (!bridge.physicalSpace) {
          input.keys.delete('Space');
          input.down?.delete('Space');
          input.touchDown?.delete('Space');
        }

        syntheticSpace = false;
        return;
      }

      input.keys.add('Space');
      input.down?.add('Space');
      input.touchDown?.add('Space');
      syntheticSpace = true;
    }, 10);

    bridge.onReset(releaseSpace);
  }
})();
