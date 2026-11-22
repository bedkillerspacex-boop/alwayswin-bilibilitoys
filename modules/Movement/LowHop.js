(() => {
  'use strict';

  /* LowHop：降低跳跃高度以加快连跳节奏。
     - Legit 模式：保留起跳初速度不变，仅在上升阶段平滑施加轻微额外重力衰减（无瞬间速度跳变，安全稳健）
     - Blatant 模式：在起跳瞬间直接按 Jump Scale 缩放垂直初速度 */

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
    const module = getMod('LowHop');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const modeSetting = module.settings.find((s) => s.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] || 'Legit';
    const jumpScale = Math.max(0.35, Math.min(0.95, Number(setting(module, 'Jump Scale', 0.72)) || 0.72));
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'lowhop',
      enabled: Boolean(module.on),
      mode,
      jumpScale
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
    name: 'LowHop',
    desc: 'Lowers jump height for faster bunnyhop cadence (Legit uses smooth ascent gravity).',
    cat: 'Movement',
    nm: { l: 'lowhop', ls: 'low hop', n: 'LowHop', ns: 'Low Hop' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'Legit applies smooth extra ascent gravity; Blatant scales takeoff velocity; Bug suppresses Y pullback & times server jump.', v: 0, vals: ['Legit', 'Blatant', 'Bug'] },
      { t: 'n', n: 'Jump Scale', d: 'Lower values produce lower jumps.', v: 0.72, min: 0.35, max: 0.95, step: 0.02 }
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
    const STEP = 1 / 60;

    let enabled = false;
    let mode = 'Legit';
    let jumpScale = 0.72;
    let simPatched = false;
    let enginePatched = false;
    let latestServerGround = true;
    let prevOnGround = false;
    let prevJumpCount = null;

    function patchNetInput(engine) {
      const net = engine?.net;

      if (!net || typeof net.input !== 'function' || net.input.__solsticeLowHopBugPatched) {
        return;
      }

      const originalInput = net.input;
      const wrappedInput = function wrappedLowHopBugInput(input, ...rest) {
        if (enabled && mode === 'Bug' && input && !latestServerGround && (input.buttons & 1)) {
          input = { ...input, buttons: input.buttons & ~1 };
        }

        return originalInput.call(this, input, ...rest);
      };

      Object.defineProperty(wrappedInput, '__solsticeLowHopBugPatched', { value: true });
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

          if (!proto || typeof proto.snapshot !== 'function' || proto.snapshot.__solsticeLowHopBugPatched) {
            return;
          }

          const originalSnapshot = proto.snapshot;
          const wrappedSnapshot = function wrappedLowHopBugSnapshot(s, ...rest) {
            patchNetInput(this);
            const me = s?.players?.find((p) => p.id === this.net?.id);

            if (me) {
              latestServerGround = Boolean(me.ground);
            }

            if (!enabled || mode !== 'Bug' || !this.predicted || !this.player?.alive || !me?.alive) {
              return originalSnapshot.call(this, s, ...rest);
            }

            const before = {
              y: this.predicted.y,
              vy: this.predicted.vy,
              vx: this.predicted.vx,
              vz: this.predicted.vz,
              ground: this.predicted.ground
            };

            const result = originalSnapshot.call(this, s, ...rest);

            if (this.predicted) {
              // Preserve horizontal speed if snapshot reconciliation tried to slow us down
              if (Math.hypot(before.vx, before.vz) > Math.hypot(this.predicted.vx, this.predicted.vz)) {
                this.predicted.vx = before.vx;
                this.predicted.vz = before.vz;
              }

              // One-way downward pullback: reject upward pullback while server is airborne;
              // accept downward/ground pullback immediately without vertical error lag
              if (!me.ground && this.predicted.y > before.y + 0.03) {
                this.predicted.y = before.y;
                this.predicted.vy = Math.min(this.predicted.vy, before.vy);
                this.predicted.ground = before.ground;
              }

              if (this.error) {
                this.error.y = 0;
              }
            }

            return result;
          };

          Object.defineProperty(wrappedSnapshot, '__solsticeLowHopBugPatched', { value: true });
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

          if (!proto || typeof proto.move !== 'function' || proto.move.__solsticeLowHopPatched) {
            return;
          }

          const originalMove = proto.move;
          const wrappedMove = function wrappedLowHopMove(motionState, input, ...rest) {
            const wasGround = Boolean(motionState?.ground);
            const wasJumpHeld = Boolean(motionState?.jumpHeld);
            const result = originalMove.call(this, motionState, input, ...rest);

            if (!enabled || !motionState) {
              return result;
            }

            if (mode === 'Bug') {
              if (wasGround && !wasJumpHeld && !motionState.ground && motionState.vy > 0) {
                motionState.vy *= jumpScale;
              } else if (!motionState.ground) {
                motionState.vy -= 22 * STEP * 0.85;
              }
            } else if (mode === 'Blatant') {
              if (wasGround && !wasJumpHeld && !motionState.ground && motionState.vy > 0) {
                motionState.vy *= jumpScale;
              }
            } else if (!wasGround && !motionState.ground && motionState.vy > 0) {
              const extraDrop = 22 * STEP * (1 - jumpScale) * 1.1;
              motionState.vy = Math.max(0, motionState.vy - extraDrop);
            }

            return result;
          };

          Object.defineProperty(wrappedMove, '__solsticeLowHopPatched', { value: true });
          proto.move = wrappedMove;
        })
        .catch(() => {
          simPatched = false;
        });
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'lowhop') {
        return;
      }

      enabled = Boolean(data.enabled);
      mode = data.mode === 'Blatant' || data.mode === 'Bug' ? data.mode : 'Legit';
      jumpScale = Math.max(0.35, Math.min(0.95, Number(data.jumpScale) || 0.72));

      if (enabled) {
        installSimPatch();
        if (mode === 'Bug') {
          installEnginePatch();
        }
      }
    });

    bridge.onPlayerUpdate(() => {
      const player = bridge.getGH()?.debug?.player;

      if (!player) {
        return;
      }

      const jumpCount = Number(player.ev?.jump) || 0;
      const onGround = Boolean(player.e?.onGround);

      if (enabled && !bridge.active && player.vel) {
        if (mode === 'Blatant') {
          if (
            ((prevJumpCount !== null && jumpCount > prevJumpCount) || (prevOnGround && !onGround)) &&
            player.vel.y > 0
          ) {
            player.vel.y *= jumpScale;
          }
        } else if (!prevOnGround && !onGround && player.vel.y > 0) {
          player.vel.y = Math.max(0, player.vel.y - 22 * STEP * (1 - jumpScale) * 1.1);
        }
      }

      prevOnGround = onGround;
      prevJumpCount = jumpCount;
    }, 25);

    bridge.onReset(() => {
      prevOnGround = false;
      prevJumpCount = null;
    });
  }
})();
