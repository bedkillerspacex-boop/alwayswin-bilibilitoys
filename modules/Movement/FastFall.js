(() => {
  'use strict';

  /* FastFall：在跳跃上升过拐点或达到 Trigger VY 时强制将垂直速度切为向下（-Fall Speed），
     配合 NoJumpDelay / bhop 快速落地衔接下一跳，实现连跳加速。 */

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
    const module = getMod('FastFall');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const triggerVy = Math.max(-2, Math.min(5, Number(setting(module, 'Trigger VY', 2.5)) || 2.5));
    const fallSpeed = Math.max(5, Math.min(25, Number(setting(module, 'Fall Speed', 12)) || 12));
    const legit = Boolean(setting(module, 'Legit', false));
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'fastfall',
      enabled: Boolean(module.on),
      triggerVy,
      fallSpeed,
      legit
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
    name: 'FastFall',
    desc: 'Pulls you downward after jump apex to chain bunnyhops faster.',
    cat: 'Movement',
    nm: { l: 'fastfall', ls: 'fast fall', n: 'FastFall', ns: 'Fast Fall' },
    disp: 'Fall Speed',
    settings: [
      { t: 'b', n: 'Legit', d: 'Zeros remaining upward momentum (vy = 0) instead of forcing downward speed.', v: 0 },
      { t: 'n', n: 'Trigger VY', d: 'Vertical velocity threshold to start fast-falling.', v: 2.5, min: -2, max: 5, step: 0.5 },
      { t: 'n', n: 'Fall Speed', d: 'Downward velocity applied when fast-falling (non-Legit).', v: 12, min: 5, max: 25, step: 0.5 }
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
    let triggerVy = 2.5;
    let fallSpeed = 12;
    let legit = false;
    let simPatched = false;

    function installSimPatch() {
      if (simPatched) {
        return;
      }

      simPatched = true;
      const simUrl = new URL('client/simulation.js', location.href).href;

      import(simUrl)
        .then(({ World }) => {
          const proto = World?.prototype;

          if (!proto || typeof proto.move !== 'function' || proto.move.__solsticeFastFallPatched) {
            return;
          }

          const originalMove = proto.move;
          const wrappedMove = function wrappedFastFallMove(motionState, input, ...rest) {
            const wasGround = Boolean(motionState?.ground);
            const result = originalMove.call(this, motionState, input, ...rest);

            if (
              enabled &&
              motionState &&
              !wasGround &&
              !motionState.ground &&
              motionState.vy <= triggerVy
            ) {
              const moving =
                Math.abs(Number(input?.forward) || 0) > 0.01 ||
                Math.abs(Number(input?.right) || 0) > 0.01;

              if (moving) {
                if (legit) {
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

          Object.defineProperty(wrappedMove, '__solsticeFastFallPatched', { value: true });
          proto.move = wrappedMove;
        })
        .catch(() => {
          simPatched = false;
        });
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'fastfall') {
        return;
      }

      enabled = Boolean(data.enabled);
      triggerVy = Math.max(-2, Math.min(5, Number(data.triggerVy) || 2.5));
      fallSpeed = Math.max(5, Math.min(25, Number(data.fallSpeed) || 12));
      legit = Boolean(data.legit);

      if (enabled) {
        installSimPatch();
      }
    });

    bridge.onPlayerUpdate(() => {
      if (!enabled || bridge.active) {
        return;
      }

      const player = bridge.getGH()?.debug?.player;

      if (!player || player.e?.onGround || player.mode === 'mantle') {
        return;
      }

      if (player.vel && player.vel.y <= triggerVy) {
        if (legit) {
          if (player.vel.y > 0) {
            player.vel.y = 0;
          }
        } else if (player.vel.y > -fallSpeed) {
          player.vel.y = -fallSpeed;
        }
      }
    }, 25);
  }
})();
