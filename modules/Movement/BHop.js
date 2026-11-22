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
      autoJump: Boolean(setting(module, 'Auto Jump', true)),
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
      { t: 'b', n: 'Auto Jump', d: 'Automatically jump immediately on ground contact while moving.', v: 1 },
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
    let autoJump = true;
    let lowHop = true;
    let jumpScale = 0.72;
    let fastFall = true;
    let legitFall = false;
    let triggerVy = 2.5;
    let fallSpeed = 12;

    let simPatched = false;
    let enginePatched = false;
    let latestServerGround = true;
    let syntheticSpace = false;
    let prevOnGround = false;
    let prevJumpCount = null;

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

      if (!net || typeof net.input !== 'function' || net.input.__solsticeBHopPatched) {
        return;
      }

      const originalInput = net.input;
      const wrappedInput = function wrappedBHopInput(input, ...rest) {
        if (enabled && mode === 'Bug' && input && !latestServerGround && (input.buttons & 1)) {
          input = { ...input, buttons: input.buttons & ~1 };
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
            }

            if (!enabled || !this.predicted || !this.player?.alive || !me?.alive) {
              return originalSnapshot.call(this, s, ...rest);
            }

            if (mode === 'Smart') {
              const result = originalSnapshot.call(this, s, ...rest);

              if (this.error) {
                this.error.y = 0;
              }

              return result;
            }

            if (mode !== 'Bug') {
              return originalSnapshot.call(this, s, ...rest);
            }

            const before = {
              x: this.predicted.x,
              y: this.predicted.y,
              z: this.predicted.z,
              vx: this.predicted.vx,
              vy: this.predicted.vy,
              vz: this.predicted.vz,
              ground: this.predicted.ground
            };

            const result = originalSnapshot.call(this, s, ...rest);

            if (this.predicted) {
              // Never allow server reconciliation to reduce horizontal velocity or yank (x, z) backward
              if (Math.hypot(before.vx, before.vz) > Math.hypot(this.predicted.vx, this.predicted.vz)) {
                this.predicted.vx = before.vx;
                this.predicted.vz = before.vz;
              }

              if (Math.hypot(this.predicted.x - before.x, this.predicted.z - before.z) < 2) {
                this.predicted.x = before.x;
                this.predicted.z = before.z;
              }

              // One-way downward Y pullback: stay low locally, snap down cleanly when server lands
              if (!me.ground && this.predicted.y > before.y + 0.03) {
                this.predicted.y = before.y;
                this.predicted.vy = Math.min(this.predicted.vy, before.vy);
                this.predicted.ground = before.ground;
              }

              if (this.previousPosition) {
                this.previousPosition.x = this.predicted.x;
                this.previousPosition.y = this.predicted.y;
                this.previousPosition.z = this.predicted.z;
              }

              if (this.error) {
                this.error.x = 0;
                this.error.y = 0;
                this.error.z = 0;
              }
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
      autoJump = data.autoJump !== false;
      lowHop = data.lowHop !== false;
      jumpScale = Math.max(0.35, Math.min(0.95, Number(data.jumpScale) || 0.72));
      fastFall = data.fastFall !== false;
      legitFall = Boolean(data.legitFall);
      triggerVy = Math.max(-2, Math.min(5, Number(data.triggerVy) || 2.5));
      fallSpeed = Math.max(5, Math.min(25, Number(data.fallSpeed) || 12));

      if (enabled) {
        installSimPatch();
        installEnginePatch();
      } else {
        releaseSpace();
      }
    });

    bridge.onBeforePlayerUpdate(() => {
      if (!enabled || !autoJump) {
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

    bridge.onReset(releaseSpace);
  }
})();
