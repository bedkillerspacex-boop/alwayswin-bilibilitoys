(() => {
  'use strict';

  /* Simulation Disabler：
     1. No Reconcile：拦截 Engine.prototype.snapshot() 对 this.predicted 的回拉/重演，避免 Speed / HighJump / NoClip 时客户端被快照拉回
     2. Drop Input（可选）：拦截 net.input() 移动输入包，让服务端停止推进你的移动模拟 */

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

  function boolOf(module, name, fallback) {
    const setting = module.settings.find((entry) => entry.n === name);
    return setting ? Boolean(setting.v) : fallback;
  }

  function syncConfig() {
    const module = getMod('SimulationDisabler');

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
      module: 'simulationdisabler',
      enabled: Boolean(module.on),
      noReconcile: boolOf(module, 'No Reconcile', true),
      dropInput: boolOf(module, 'Drop Input', false)
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
    name: 'SimulationDisabler',
    desc: 'Disables online simulation reconciliation and optionally drops movement input packets.',
    cat: 'Movement',
    nm: {
      l: 'simulationdisabler',
      ls: 'simulation disabler',
      n: 'SimulationDisabler',
      ns: 'Simulation Disabler'
    },
    disp: '',
    settings: [
      { t: 'b', n: 'No Reconcile', d: 'Prevents server snapshots from snapping predicted position back.', v: 1 },
      { t: 'b', n: 'Drop Input', d: 'Drops outgoing movement input packets to the server.', v: 0 }
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
    let noReconcile = true;
    let dropInput = false;
    let enginePatched = false;

    function patchNetInput(engine) {
      const net = engine?.net;

      if (!net || typeof net.input !== 'function' || net.input.__solsticeSimDisablerPatched) {
        return;
      }

      const originalInput = net.input;
      const wrappedInput = function wrappedSimDisablerInput(...args) {
        if (enabled && dropInput) {
          return Promise.resolve();
        }

        return originalInput.apply(this, args);
      };

      Object.defineProperty(wrappedInput, '__solsticeSimDisablerPatched', { value: true });
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

          if (!proto || typeof proto.snapshot !== 'function' || proto.snapshot.__solsticeSimDisablerPatched) {
            return;
          }

          const originalSnapshot = proto.snapshot;
          const wrappedSnapshot = function wrappedSimDisablerSnapshot(s, ...rest) {
            patchNetInput(this);

            if (!enabled || !noReconcile || !this.predicted || !this.player?.alive) {
              return originalSnapshot.call(this, s, ...rest);
            }

            const me = s?.players?.find((p) => p.id === this.net?.id);
            const shouldPreserve = Boolean(me && me.alive && this.roundStarted);
            const savedPredicted = shouldPreserve ? { ...this.predicted } : null;
            const savedPrev = shouldPreserve && this.previousPosition ? { ...this.previousPosition } : null;
            const savedVisualVel = shouldPreserve && this.visualVelocity ? { ...this.visualVelocity } : null;
            const savedAccumulator = this.accumulator;
            const savedStairRise = this.stairRise;
            const savedPrevStair = this.previousStairRise;
            const savedRenderedStair = this.renderedStairRise;

            const result = originalSnapshot.call(this, s, ...rest);

            if (savedPredicted && this.player?.alive) {
              this.predicted = savedPredicted;
              this.error = { x: 0, y: 0, z: 0 };

              if (savedPrev) {
                this.previousPosition = savedPrev;
              }

              if (savedVisualVel) {
                this.visualVelocity = savedVisualVel;
              }

              this.accumulator = savedAccumulator;
              this.stairRise = savedStairRise;
              this.previousStairRise = savedPrevStair;
              this.renderedStairRise = savedRenderedStair;
              this.pending = [];
            }

            return result;
          };

          Object.defineProperty(wrappedSnapshot, '__solsticeSimDisablerPatched', { value: true });
          proto.snapshot = wrappedSnapshot;
        })
        .catch(() => {
          enginePatched = false;
        });
    }

    bridge.onConfig('solstice-movement', (data) => {
      if (data.type !== 'config' || data.module !== 'simulationdisabler') {
        return;
      }

      enabled = Boolean(data.enabled);
      noReconcile = data.noReconcile !== false;
      dropInput = Boolean(data.dropInput);

      if (enabled) {
        installEnginePatch();
      }
    });
  }
})();
