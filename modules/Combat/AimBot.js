

(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && (location.pathname.startsWith('/toy/golden-hour/') || location.pathname.startsWith('/toy/potatoepic/'))) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const gamePrefix = () => (document.documentElement?.getAttribute('data-solstice-game') === 'potatoepic' || location.pathname.includes('/potatoepic/')) ? '/toy/potatoepic/' : '/toy/golden-hour/';
  const MIN_SEND_INTERVAL_MS = 100;
  const HEARTBEAT_MS = 500;

  let lastSentKey = '';
  let lastSentAt = 0;

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}${gamePrefix()}`)) {
        return frame;
      }
    }

    return null;
  }

  function setting(module, name, fallback) {
    const value = module.settings.find((entry) => entry.n === name);
    return value ? value.v : fallback;
  }

  function syncConfig() {
    const module = getMod('AimBot');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const modeSetting = module.settings.find((entry) => entry.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] === 'Single' ? 'Single' : 'Switch';
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'aimbot',
      enabled: Boolean(module.on),
      mode,
      fov: Math.max(5, Math.min(180, Number(setting(module, 'FOV', 60)))),
      smooth: Math.max(1, Math.min(20, Number(setting(module, 'Aim Smooth', 4)))),
      wallCheck: Boolean(setting(module, 'Wall Check', true)),
      rightClick: Boolean(setting(module, 'Right Click', false)),
      dontLockHead: Boolean(setting(module, 'DoNot Lock Head', false))
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
    name: 'AimBot',
    desc: 'Smoothly aims at enemy heads.',
    cat: "Combat",
    nm: { l: 'aimbot', ls: 'aim bot', n: 'AimBot', ns: 'Aim Bot' },
    disp: '',
    settings: [
      { t: 'e', n: 'Mode', d: 'Switch picks closest angle each frame; Single locks one target until lost.', v: 0, vals: ['Switch', 'Single'] },
      { t: 'n', n: 'FOV', d: 'Maximum angle in degrees from crosshair.', v: 60, min: 5, max: 180, step: 1 },
      {
        t: 'n',
        n: 'Aim Smooth',
        d: 'Higher values make the aim smoother and slower.',
        v: 4.0,
        min: 1.0,
        max: 20.0,
        step: 0.1
      },
      { t: 'b', n: 'Wall Check', d: 'Only aim at targets that are not behind walls.', v: 1 },
      { t: 'b', n: 'Right Click', d: 'Only aim while holding the right mouse button.', v: 0 },
      { t: 'b', n: 'DoNot Lock Head', d: 'Aim at any exposed body part instead of only locking the head.', v: 0 }
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
    let config = {
      enabled: false,
      mode: 'Switch',
      fov: 60,
      smooth: 4,
      wallCheck: true,
      rightClick: false,
      dontLockHead: false
    };
    let lockedTargetKey = '';

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type !== 'config' || data.module !== 'aimbot') {
        return;
      }

      const smooth = Number(data.smooth);
      const fov = Number(data.fov);

      config = {
        enabled: Boolean(data.enabled),
        mode: data.mode === 'Single' ? 'Single' : 'Switch',
        fov: Number.isFinite(fov) ? bridge.clamp(fov, 5, 180) : 60,
        smooth: Number.isFinite(smooth) ? bridge.clamp(smooth, 1, 20) : 4,
        wallCheck: data.wallCheck !== false,
        rightClick: Boolean(data.rightClick),
        dontLockHead: Boolean(data.dontLockHead)
      };
      if (!config.enabled || config.mode !== 'Single') {
        lockedTargetKey = '';
      }
    });

    bridge.onBeforePlayerUpdate((dt) => {
      if (!config.enabled) {
        lockedTargetKey = '';
        return;
      }

      const context = bridge.getContext();

      if (!context) {
        return;
      }

      const { player, camera, input, actors } = context;
      const aura = bridge.getFeature('aura');
      const syntheticAds = Boolean(aura?.isSyntheticAds?.());
      const rightHeld = bridge.physicalRmb || (input.held?.('Mouse2') && !syntheticAds);

      if (config.rightClick && !rightHeld) {
        lockedTargetKey = '';
        return;
      }

      const forward = player.pos.clone();
      const head = player.pos.clone();
      if (bridge.game === 'potatoepic') {
        const cosPitch = Math.cos(player.pitch);
        forward.set(
          -Math.sin(player.yaw) * cosPitch,
          Math.sin(player.pitch),
          -Math.cos(player.yaw) * cosPitch
        );
      } else {
        camera.getWorldDirection(forward);
      }

      const eye = typeof bridge.getEye === 'function'
        ? bridge.getEye()
        : (bridge.getFeature('thirdperson')?.getEye?.() || camera.position);
      const actorKeyOf = (a) => (a.id != null ? `id:${a.id}` : a.name ? `name:${a.name}` : '');
      const evaluateActor = (actor) => {
        const raw = typeof bridge.getRawPlayer === 'function' ? bridge.getRawPlayer(actor) : null;
        if (raw && raw.alive !== false) {
          const eyeHeight = raw.sliding ? 0.72 : raw.crouch ? 1.0 : 1.62;
          head.set(raw.x, raw.y + eyeHeight, raw.z);
        } else {
          bridge.headPoint(actor, head);
        }

        const points = [{ x: head.x, y: head.y, z: head.z }];
        const btPt = bridge.getFeature('backtrack')?.getAimPoint?.(actor);
        if (btPt) {
          points.push({ x: btPt.x, y: btPt.y, z: btPt.z });
        }
        if (config.dontLockHead) {
          const box = Array.isArray(actor.box) && actor.box.length >= 6 ? actor.box : null;
          const bx = raw ? raw.x : box ? (box[0] + box[3]) * 0.5 : actor.pos.x;
          const by = raw ? raw.y : box ? box[1] : actor.pos.y;
          const bz = raw ? raw.z : box ? (box[2] + box[5]) * 0.5 : actor.pos.z;
          const h = raw
            ? (raw.sliding ? 0.95 : raw.crouch ? 1.2 : 1.8)
            : box ? Math.max(0.4, box[4] - box[1]) : (Number(actor.e?.h) > 0.2 ? Number(actor.e.h) : 1.8);
          const hw = box ? Math.max(0.18, Math.min(0.4, (box[3] - box[0]) * 0.35)) : 0.24;
          const hd = box ? Math.max(0.18, Math.min(0.4, (box[5] - box[2]) * 0.35)) : 0.24;
          points.push(
            { x: bx, y: by + h * 0.72, z: bz },
            { x: bx, y: by + h * 0.52, z: bz },
            { x: bx, y: by + h * 0.34, z: bz },
            { x: bx + hw, y: by + h * 0.65, z: bz },
            { x: bx - hw, y: by + h * 0.65, z: bz },
            { x: bx, y: by + h * 0.65, z: bz + hd },
            { x: bx, y: by + h * 0.65, z: bz - hd },
            { x: bx, y: by + h * 0.18, z: bz }
          );
        }

        let bestPt = null;
        let bestAngle = Infinity;
        for (const pt of points) {
          const dx = pt.x - eye.x;
          const dy = pt.y - eye.y;
          const dz = pt.z - eye.z;
          const len = Math.hypot(dx, dy, dz);
          if (len < 0.001) continue;

          const dot = bridge.clamp((dx * forward.x + dy * forward.y + dz * forward.z) / len, -1, 1);
          const angleDeg = Math.acos(dot) * (180 / Math.PI);
          if (angleDeg > config.fov || angleDeg >= bestAngle) continue;

          if (config.wallCheck && !bridge.worldLineClear(eye, pt)) continue;

          bestAngle = angleDeg;
          bestPt = pt;
        }
        return bestPt ? { pt: bestPt, angle: bestAngle } : null;
      };

      let best = null;
      let bestActor = null;
      let bestScore = Infinity;

      if (config.mode === 'Single' && lockedTargetKey) {
        const lockedActor = actors.find((a) => bridge.isEnemy(a, player) && actorKeyOf(a) === lockedTargetKey);
        const res = lockedActor ? evaluateActor(lockedActor) : null;
        if (res) {
          best = res.pt;
          bestActor = lockedActor;
          bestScore = res.angle;
        } else {
          lockedTargetKey = '';
        }
      }

      if (!best) {
        let bestActorKey = '';
        for (const actor of actors) {
          if (!bridge.isEnemy(actor, player)) continue;
          const res = evaluateActor(actor);
          if (res && res.angle < bestScore) {
            bestScore = res.angle;
            best = res.pt;
            bestActor = actor;
            bestActorKey = actorKeyOf(actor);
          }
        }
        if (config.mode === 'Single' && bestActorKey) {
          lockedTargetKey = bestActorKey;
        }
      }

      if (!best) {
        return;
      }

      if (bestActor) {
        window.SolsticeAuraTarget = bestActor;
        window.SolsticeAuraTargetAt = performance.now();
      }

      const dx = best.x - eye.x;
      const dy = best.y - eye.y;
      const dz = best.z - eye.z;
      const targetYaw = Math.atan2(-dx, -dz);
      const targetPitch = Math.atan2(dy, Math.hypot(dx, dz));
      const frameDt = Number.isFinite(dt) ? bridge.clamp(dt, 1 / 240, 0.1) : 1 / 60;
      const factor = 1 - Math.exp(-(30 / bridge.clamp(config.smooth, 1, 20)) * frameDt);

      player.yaw += bridge.wrapAngle(targetYaw - player.yaw) * factor;
      player.pitch = bridge.clamp(player.pitch + (targetPitch - player.pitch) * factor, -1.5, 1.5);

      input.mx = 0;
      input.my = 0;
    }, 40);
  }
})();
