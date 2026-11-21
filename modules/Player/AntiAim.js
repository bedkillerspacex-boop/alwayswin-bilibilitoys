(() => {
  'use strict';

  /* AntiAim：
     - 按 input.seq 去重，避免 Engine.prototype.snapshot() 重放 pending 输入时重复推进 spinYaw 或破坏历史输入
     - Derp Mode：按固定 1/60s 步长稳定旋转服务端 yaw，支持 Down / Up / Jitter 俯仰角 */

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;

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
    const module = getMod('AntiAim');

    if (!module) {
      return;
    }

    const derpSetting = module.settings.find((entry) => entry.n === 'Derp Mode');
    const speedSetting = module.settings.find((entry) => entry.n === 'Derp Speed');
    const pitchSetting = module.settings.find((entry) => entry.n === 'Derp Pitch');
    const derp = Boolean(derpSetting && derpSetting.v);
    const derpSpeed = Number(speedSetting ? speedSetting.v : 360) || 360;
    const derpPitch = pitchSetting?.vals?.[pitchSetting.v] || 'Down';

    if (speedSetting) {
      speedSetting.vis = Boolean(module.on && derp);
    }

    if (pitchSetting) {
      pitchSetting.vis = Boolean(module.on && derp);
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'antiaim',
      enabled: Boolean(module.on),
      derp,
      derpSpeed,
      derpPitch
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
    name: 'AntiAim',
    desc: 'Silently points your server-side view down and away from the nearest enemy.',
    cat: 'Player',
    nm: { l: 'antiaim', ls: 'anti aim', n: 'AntiAim', ns: 'Anti Aim' },
    disp: '',
    settings: [
      { t: 'b', n: 'Derp Mode', d: 'Spins your server-side yaw and spoofs pitch.', v: 0 },
      { t: 'n', n: 'Derp Speed', d: 'How fast the spin is, in degrees per second.', v: 360, min: 10, max: 1080, step: 5 },
      { t: 'e', n: 'Derp Pitch', d: 'Server-side pitch mode in Derp Mode.', v: 0, vals: ['Down', 'Up', 'Jitter'] }
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
    let derp = false;
    let derpSpeed = 360;
    let derpPitch = 'Down';
    let spinYaw = 0;
    let lastSeq = -1;
    let jitterPhase = 0;
    let lastSpoof = null;
    let enginePatched = false;
    const seqSpoofMap = new Map();

    function installFpBodyDerpHook() {
      const fpbody = bridge.getGH()?.debug?.fpbody;

      if (!fpbody || typeof fpbody.update !== 'function' || fpbody.update.__solsticeAntiAimFpBodyPatched) {
        return;
      }

      const originalUpdate = fpbody.update;
      const wrappedUpdate = function wrappedAntiAimFpBodyUpdate(dt, state, ...rest) {
        const thirdPerson = typeof bridge.getFeature === 'function' ? bridge.getFeature('thirdperson') : null;
        const player = state?.player || bridge.getGH()?.debug?.player;

        if (!enabled || !lastSpoof || !player || !thirdPerson?.wantsDerpBody?.()) {
          return originalUpdate.call(this, dt, state, ...rest);
        }

        const origYaw = player.yaw;
        const origPitch = player.pitch;
        player.yaw = lastSpoof.yaw;
        player.pitch = lastSpoof.pitch;

        try {
          return originalUpdate.call(this, dt, state, ...rest);
        } finally {
          player.yaw = origYaw;
          player.pitch = origPitch;
        }
      };

      Object.defineProperty(wrappedUpdate, '__solsticeAntiAimFpBodyPatched', { value: true });
      fpbody.update = wrappedUpdate;
    }

    function installRespawnViewGuard() {
      if (enginePatched) {
        return;
      }

      enginePatched = true;
      const engineUrl = new URL('client/engine.js', location.href).href;

      import(engineUrl)
        .then(({ Engine }) => {
          const proto = Engine?.prototype;

          if (!proto || typeof proto.snapshot !== 'function' || proto.snapshot.__solsticeAntiAimGuardPatched) {
            return;
          }

          const originalSnapshot = proto.snapshot;
          const wrappedSnapshot = function wrappedAntiAimSnapshot(s, ...rest) {
            const p = this.player;
            const prevYaw = p?.yaw;
            const prevPitch = p?.pitch;
            const wasAlive = Boolean(p?.alive);
            const result = originalSnapshot.call(this, s, ...rest);

            if (enabled && p && !wasAlive && p.alive && Number.isFinite(prevYaw) && Number.isFinite(prevPitch)) {
              p.yaw = prevYaw;
              p.pitch = prevPitch;
            }

            return result;
          };

          Object.defineProperty(wrappedSnapshot, '__solsticeAntiAimGuardPatched', { value: true });
          proto.snapshot = wrappedSnapshot;
        })
        .catch(() => {
          enginePatched = false;
        });
    }

    function derpAngles() {
      spinYaw = bridge.wrapAngle(spinYaw + (derpSpeed * Math.PI / 180) * STEP);
      jitterPhase ^= 1;

      let pitch = -1.5;

      if (derpPitch === 'Up') {
        pitch = 1.5;
      } else if (derpPitch === 'Jitter') {
        pitch = jitterPhase ? -1.5 : 1.5;
      }

      return {
        yaw: spinYaw,
        pitch
      };
    }

    function anglesToPoint(eye, point) {
      const dx = point.x - eye.x;
      const dy = point.y - eye.y;
      const dz = point.z - eye.z;

      return {
        yaw: Math.atan2(-dx, -dz),
        pitch: Math.atan2(dy, Math.hypot(dx, dz))
      };
    }

    function antiAngles(player, actors) {
      const enemy = bridge.nearestEnemy(player, actors);

      if (!enemy) {
        return {
          yaw: bridge.wrapAngle(player.yaw + Math.PI),
          pitch: -1.5
        };
      }

      const dx = enemy.pos.x - player.pos.x;
      const dz = enemy.pos.z - player.pos.z;
      const towardYaw = Math.atan2(-dx, -dz);

      return {
        yaw: bridge.wrapAngle(towardYaw + Math.PI),
        pitch: -1.5
      };
    }

    function spoofFor(player, camera, actors) {
      if (derp) {
        return derpAngles();
      }

      const aura = bridge.getFeature('aura');

      if (aura?.getTarget?.() && aura.canFireNow?.()) {
        const point = aura.getAimPoint?.(camera.position);

        if (point) {
          return anglesToPoint(camera.position, point);
        }
      }

      return antiAngles(player, actors);
    }

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type === 'config' && data.module === 'antiaim') {
        enabled = Boolean(data.enabled);

        if (data.derp !== undefined) {
          derp = Boolean(data.derp);
        }

        if (Number.isFinite(Number(data.derpSpeed))) {
          derpSpeed = Math.max(10, Math.min(1080, Number(data.derpSpeed)));
        }

        if (data.derpPitch === 'Up' || data.derpPitch === 'Jitter' || data.derpPitch === 'Down') {
          derpPitch = data.derpPitch;
        }

        if (enabled) {
          installRespawnViewGuard();
          installFpBodyDerpHook();
        } else {
          lastSeq = -1;
          lastSpoof = null;
          seqSpoofMap.clear();
        }
      }
    });

    bridge.onWorldMove((context) => {
      if (!enabled || !document.body.classList.contains('online-session')) {
        return;
      }

      const game = bridge.getContext();

      if (!game || !game.player?.alive || !context.input) {
        return;
      }

      const input = context.input;
      const seq = Number(input.seq);
      let spoof;

      if (Number.isFinite(seq) && seqSpoofMap.has(seq)) {
        spoof = seqSpoofMap.get(seq);
      } else {
        if (Number.isFinite(seq) && seq <= lastSeq) {
          return;
        }

        if (Number.isFinite(seq)) {
          lastSeq = seq;
        }

        spoof = spoofFor(game.player, game.camera, game.actors);

        if (spoof && Number.isFinite(seq)) {
          seqSpoofMap.set(seq, spoof);

          if (seqSpoofMap.size > 160) {
            const firstKey = seqSpoofMap.keys().next().value;
            seqSpoofMap.delete(firstKey);
          }
        }
      }

      if (!spoof) {
        return;
      }

      lastSpoof = spoof;
      installFpBodyDerpHook();

      if (context.localInput === context.input) {
        context.localInput = { ...context.input };
      }

      const localYaw = Number(input.yaw) || 0;
      const localPitch = Number(input.pitch) || 0;
      const forward = Number(input.forward) || 0;
      const right = Number(input.right) || 0;
      const worldX = -Math.sin(localYaw) * forward + Math.cos(localYaw) * right;
      const worldZ = -Math.cos(localYaw) * forward - Math.sin(localYaw) * right;
      const sin = Math.sin(spoof.yaw);
      const cos = Math.cos(spoof.yaw);

      input.yaw = spoof.yaw;
      input.pitch = spoof.pitch;
      input.forward = -sin * worldX - cos * worldZ;
      input.right = cos * worldX - sin * worldZ;

      queueMicrotask(() => {
        if (input.yaw !== spoof.yaw || input.pitch !== spoof.pitch) {
          return;
        }

        input.yaw = localYaw;
        input.pitch = localPitch;
        input.forward = forward;
        input.right = right;
      });
    }, 30);

    bridge.onReset(() => {
      lastSeq = -1;
      lastSpoof = null;
      seqSpoofMap.clear();
    });

    setInterval(installFpBodyDerpHook, 500);
  }
})();
