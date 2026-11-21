(() => {
  'use strict';

  /* HighJump：提高跳跃高度（联机通过 World.prototype.move 放大起跳 vy，单机通过 player.vel.y 放大）。 */

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
    const module = getMod('HighJump');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const multiplier = Math.max(
      1,
      Math.min(4, Number((module.settings.find((s) => s.n === 'Multiplier') || { v: 1.5 }).v) || 1.5)
    );
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'highjump',
      enabled: Boolean(module.on),
      multiplier
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
    name: 'HighJump',
    desc: 'Increases jump height by scaling vertical jump velocity.',
    cat: 'Movement',
    nm: { l: 'highjump', ls: 'high jump', n: 'HighJump', ns: 'High Jump' },
    disp: 'Multiplier',
    settings: [
      { t: 'n', n: 'Multiplier', d: 'Vertical jump velocity multiplier.', v: 1.5, min: 1, max: 4, step: 0.05 }
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
    let multiplier = 1.5;
    let simPatched = false;
    let prevOnGround = false;
    let prevJumpCount = null;

    function installSimPatch() {
      if (simPatched) {
        return;
      }

      simPatched = true;
      const simUrl = new URL('client/simulation.js', location.href).href;

      import(simUrl)
        .then(({ World }) => {
          const proto = World?.prototype;

          if (!proto || typeof proto.move !== 'function' || proto.move.__solsticeHighJumpPatched) {
            return;
          }

          const originalMove = proto.move;
          const wrappedMove = function wrappedHighJumpMove(motionState, input, ...rest) {
            const wasGround = Boolean(motionState?.ground);
            const wasJumpHeld = Boolean(motionState?.jumpHeld);
            const result = originalMove.call(this, motionState, input, ...rest);

            if (enabled && motionState && wasGround && !wasJumpHeld && !motionState.ground && motionState.vy > 0) {
              motionState.vy *= multiplier;
            }

            return result;
          };

          Object.defineProperty(wrappedMove, '__solsticeHighJumpPatched', { value: true });
          proto.move = wrappedMove;
        })
        .catch(() => {
          simPatched = false;
        });
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'highjump') {
        return;
      }

      enabled = Boolean(data.enabled);
      multiplier = Math.max(1, Math.min(4, Number(data.multiplier) || 1.5));

      if (enabled) {
        installSimPatch();
      }
    });

    bridge.onPlayerUpdate(() => {
      const player = bridge.getGH()?.debug?.player;

      if (!player) {
        return;
      }

      const jumpCount = Number(player.ev?.jump) || 0;
      const onGround = Boolean(player.e?.onGround);

      if (enabled && prevJumpCount !== null && jumpCount > prevJumpCount && player.vel?.y > 0) {
        player.vel.y *= multiplier;
      } else if (enabled && prevOnGround && !onGround && player.vel?.y > 0 && !bridge.active) {
        player.vel.y *= multiplier;
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
