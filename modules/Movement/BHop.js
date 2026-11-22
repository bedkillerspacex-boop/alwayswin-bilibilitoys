(() => {
  'use strict';

  /* BHop：整合 LowHop + FastFall，提供 Bug / Smart / Custom 三种模式。
     - Bug：0.52x 起跳 + -16 快速下坠 + 禁止水平回拉减速与向上拉回，最快连跳循环
     - Smart：0.65x 起跳 + -13 快速下坠 + 清零垂直误差抖动，兼顾服务端同步与高速连跳
     - Custom：保留完整 LowHop + FastFall 自定义参数 */

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
    const module = getMod('BHop');

    if (!module) {
      return;
    }

    const modeSetting = module.settings.find((s) => s.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] || 'Bug';
    const isCustom = mode === 'Custom';

    for (const entry of module.settings) {
      if (
        entry.n === 'LowHop' ||
        entry.n === 'Jump Scale' ||
        entry.n === 'FastFall' ||
        entry.n === 'Legit Fall' ||
        entry.n === 'Trigger VY' ||
        entry.n === 'Fall Speed'
      ) {
        entry.vis = isCustom;
      }
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'bhop',
      enabled: Boolean(module.on),
      mode,
      lowHop: Boolean(setting(module, 'LowHop', true)),
      jumpScale: Math.max(0.35, Math.min(0.95, Number(setting(module, 'Jump Scale', 0.72)) || 0.72)),
      fastFall: Boolean(setting(module, 'FastFall', true)),
      legitFall: Boolean(setting(module, 'Legit Fall', false)),
      triggerVy: Math.max(-2, Math.min(5, Number(setting(module, 'Trigger VY', 2.5)) || 2.5)),
      fallSpeed: Math.max(5, Math.min(25, Number(setting(module, 'Fall Speed', 12)) || 12))
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
    name: 'BHop',
    desc: 'Combined LowHop + FastFall bunnyhop with Bug, Smart, and Custom modes.',
    cat: 'Movement',
    nm: { l: 'bhop', ls: 'b hop', n: 'BHop', ns: 'BHop' },
    disp: 'Mode',
    settings: [
      {
        t: 'e',
        n: 'Mode',
        d: 'Bug = fastest pullback bhop without horizontal slowdown; Smart = fast synced bhop; Custom = manual LowHop/FastFall.',
        v: 0,
        vals: ['Bug', 'Smart', 'Custom']
      },
      { t: 'b', n: 'LowHop', d: 'Scale jump takeoff velocity.', v: 1 },
      { t: 'n', n: 'Jump Scale', d: 'Lower values produce lower jumps.', v: 0.72, min: 0.35, max: 0.95, step: 0.02 },
      { t: 'b', n: 'FastFall', d: 'Pull downward after jump apex.', v: 1 },
      { t: 'b', n: 'Legit Fall', d: 'Zeros upward momentum (vy = 0) instead of forcing downward speed.', v: 0 },
      { t: 'n', n: 'Trigger VY', d: 'Vertical velocity threshold to start fast-falling.', v: 2.5, min: -2, max: 5, step: 0.5 },
      { t: 'n', n: 'Fall Speed', d: 'Downward velocity applied when fast-falling.', v: 12, min: 5, max: 25, step: 0.5 }
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
    let mode = 'Bug';
    let lowHop = true;
    let jumpScale = 0.72;
    let fastFall = true;
    let legitFall = false;
    let triggerVy = 2.5;
    let fallSpeed = 12;

    let simPatched = false;
    let enginePatched = false;
    let latestServerGround = true;
    let latestServerSpeed = 0;
    let latestServerSliding = false;
    let latestServerCrouch = false;
    let latestServerSlideCooldown = 0;
    let prevOnGround = false;
    let prevJumpCount = null;

    function patchNetInput(engine) {
      const net = engine?.net;

      if (!net || typeof net.input !== 'function' || net.input.__solsticeBHopPatched) {
        return;
      }

      const originalInput = net.input;
      const wrappedInput = function wrappedBHopInput(input, ...rest) {
        if (enabled && mode === 'Bug' && input) {
          const moving = Math.hypot(Number(input.forward) || 0, Number(input.right) || 0) > 0.01;
          let buttons = input.buttons | 0;

          if (moving && !(buttons & 8)) {
            buttons |= 2; // SPRINT
          }

          if (!latestServerGround) {
            buttons &= ~1; // keep server jumpHeld=false while server is still airborne
          } else if (
            moving &&
            !latestServerSliding &&
            !latestServerCrouch &&
            latestServerSlideCooldown <= 0 &&
            latestServerSpeed > 5.2
          ) {
            buttons |= 16; // trigger server 1.3x slide boost (9.75 - 11.0 m/s)
          }

          if (buttons !== input.buttons) {
            input = { ...input, buttons };
          }
        }

        return originalInput.call(this, input, ...rest);
      };

      Object.defineProperty(wrappedInput, '__solsticeBHopPatched', { value: true });
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

          if (!proto || typeof proto.snapshot !== 'function' || proto.snapshot.__solsticeBHopPatched) {
            return;
          }

          const originalSnapshot = proto.snapshot;
          const wrappedSnapshot = function wrappedBHopSnapshot(s, ...rest) {
            patchNetInput(this);
            const me = s?.players?.find((p) => p.id === this.net?.id);

            if (me) {
              latestServerGround = Boolean(me.ground);
              latestServerSliding = Boolean(me.sliding);
              latestServerCrouch = Boolean(me.crouch);
              latestServerSlideCooldown = Number(me.slideCooldown) || 0;
              latestServerSpeed = Math.hypot(Number(me.vx) || 0, Number(me.vz) || 0);
            }

            const result = originalSnapshot.call(this, s, ...rest);

            if (enabled && (mode === 'Smart' || mode === 'Bug') && this.error) {
              this.error.y = 0;
            }

            return result;
          };

          Object.defineProperty(wrappedSnapshot, '__solsticeBHopPatched', { value: true });
          proto.snapshot = wrappedSnapshot;
        })
        .catch(() => {
          enginePatched = false;
        });
    }

    function installSimPatch() {
      if (simPatched) {
        return;
      }

      simPatched = true;
      const simUrl = new URL('client/simulation.js', location.href).href;

      import(simUrl)
        .then(({ World }) => {
          const proto = World?.prototype;

          if (!proto || typeof proto.move !== 'function' || proto.move.__solsticeBHopPatched) {
            return;
          }

          const originalMove = proto.move;
          const wrappedMove = function wrappedBHopMove(motionState, input, ...rest) {
            const wasGround = Boolean(motionState?.ground);
            const wasJumpHeld = Boolean(motionState?.jumpHeld);
            const result = originalMove.call(this, motionState, input, ...rest);

            if (!enabled || !motionState) {
              return result;
            }

            const moving =
              Math.abs(Number(input?.forward) || 0) > 0.01 ||
              Math.abs(Number(input?.right) || 0) > 0.01;

            if (mode === 'Bug') {
              if (wasGround && !wasJumpHeld && !motionState.ground && motionState.vy > 0) {
                motionState.vy *= 0.52;
              } else if (!wasGround && !motionState.ground && moving && motionState.vy <= 2.2) {
                if (motionState.vy > -16) {
                  motionState.vy = -16;
                }
              }
            } else if (mode === 'Smart') {
              if (wasGround && !wasJumpHeld && !motionState.ground && motionState.vy > 0) {
                motionState.vy *= 0.65;
              } else if (!wasGround && !motionState.ground && moving && motionState.vy <= 2.5) {
                if (motionState.vy > -13) {
                  motionState.vy = -13;
                }
              }
            } else {
              if (lowHop && wasGround && !wasJumpHeld && !motionState.ground && motionState.vy > 0) {
                motionState.vy *= jumpScale;
              }

              if (fastFall && !wasGround && !motionState.ground && moving && motionState.vy <= triggerVy) {
                if (legitFall) {
                  if (motionState.vy > 0) {
                    motionState.vy = 0;
                  }
                } else if (motionState.vy > -fallSpeed) {
                  motionState.vy = -fallSpeed;
                }
              }
            }

            return result;
          };

          Object.defineProperty(wrappedMove, '__solsticeBHopPatched', { value: true });
          proto.move = wrappedMove;
        })
        .catch(() => {
          simPatched = false;
        });
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'bhop') {
        return;
      }

      enabled = Boolean(data.enabled);
      mode = data.mode === 'Smart' || data.mode === 'Custom' ? data.mode : 'Bug';
      lowHop = data.lowHop !== false;
      jumpScale = Math.max(0.35, Math.min(0.95, Number(data.jumpScale) || 0.72));
      fastFall = data.fastFall !== false;
      legitFall = Boolean(data.legitFall);
      triggerVy = Math.max(-2, Math.min(5, Number(data.triggerVy) || 2.5));
      fallSpeed = Math.max(5, Math.min(25, Number(data.fallSpeed) || 12));

      if (enabled) {
        installSimPatch();
        installEnginePatch();
      }
    });

    bridge.onPlayerUpdate(() => {
      const player = bridge.getGH()?.debug?.player;

      if (!player) {
        return;
      }

      const onGround = Boolean(player.e?.onGround);
      const jumpCount = Number(player.ev?.jump) || 0;

      if (enabled && prevOnGround && !onGround && player.vel?.y > 0 && jumpCount === prevJumpCount) {
        player.ev.jump = jumpCount + 1;
      }

      prevOnGround = onGround;
      prevJumpCount = player.ev?.jump ?? jumpCount;
    });
  }
})();
