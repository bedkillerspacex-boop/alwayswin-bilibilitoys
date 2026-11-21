(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 100;
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

  function setting(module, name, fallback) {
    const value = module.settings.find((entry) => entry.n === name);
    return value ? value.v : fallback;
  }

  function syncConfig() {
    const module = getMod('Aura');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const modeSetting = module.settings.find((entry) => entry.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] === 'Single' ? 'Single' : 'Switch';
    const focusSetting = module.settings.find((entry) => entry.n === 'Focus Attacker');

    if (focusSetting) {
      focusSetting.vis = true;
    }

    const range = Math.max(0, Math.min(100, Number(setting(module, 'Range', 20)) || 0));
    const lead = Math.max(0, Math.min(0.25, Number(setting(module, 'Lead', 0)) || 0));
    const turnSpeed = Math.max(60, Math.min(1000, Number(setting(module, 'Turn Speed', 1000)) || 1000));
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'aura',
      enabled: Boolean(module.on),
      mode,
      range,
      lead,
      turnSpeed,
      focusAttacker: Boolean(setting(module, 'Focus Attacker', true)),
      deprioritizeSpawn: Boolean(setting(module, 'Deprioritize Spawn', true)),
      wallCheck: Boolean(setting(module, 'Wall Check', true)),
      ads: Boolean(setting(module, 'ADS', false)),
      legacyAura: Boolean(setting(module, 'LegacyAura', false))
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
    name: 'Aura',
    desc: 'Automatically attacks nearby enemies.',
    cat: 'Combat',
    nm: { l: 'aura', ls: 'aura', n: 'Aura', ns: 'Aura' },
    disp: 'Mode',
    settings: [
      {
        t: 'e',
        n: 'Mode',
        d: 'Switch cycles between targets; Single stays on one target until it is lost.',
        v: 0,
        vals: ['Switch', 'Single']
      },
      {
        t: 'b',
        n: 'Focus Attacker',
        d: 'Prioritizes enemies who recently damaged you (works in Switch and Single).',
        v: 1
      },
      {
        t: 'b',
        n: 'Deprioritize Spawn',
        d: 'Lowers priority of newly spawned enemies so normal enemies are targeted first.',
        v: 1
      },
      {
        t: 'n',
        n: 'Range',
        d: 'The range at which to attack enemies.',
        v: 20,
        min: 0,
        max: 100,
        step: 0.5
      },
      {
        t: 'n',
        n: 'Turn Speed',
        d: 'Aim rotation speed in deg/s (1000 = LockOn infinite speed).',
        v: 1000,
        min: 60,
        max: 1000,
        step: 10
      },
      {
        t: 'n',
        n: 'Lead',
        d: 'Velocity prediction time (seconds) for fast-moving targets.',
        v: 0,
        min: 0,
        max: 0.25,
        step: 0.01
      },
      {
        t: 'b',
        n: 'Wall Check',
        d: 'Only attack targets that are not behind walls.',
        v: 1
      },
      {
        t: 'b',
        n: 'ADS',
        d: 'Silently request ADS on the server while attacking.',
        v: 0
      },
      {
        t: 'b',
        n: 'LegacyAura',
        d: 'Use the original Aura targeting and aim logic.',
        v: 0
      }
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
      range: 20,
      lead: 0,
      turnSpeed: 1000,
      focusAttacker: true,
      deprioritizeSpawn: true,
      wallCheck: true,
      ads: false,
      legacyAura: false
    };
    let target = null;
    let singleTarget = null;
    let syntheticAds = false;
    let enginePatched = false;
    let lastAttackerId = null;
    let lastAttackerAt = 0;
    let aimYaw = null;
    let aimPitch = null;
    let lastTurnAt = 0;
    const lastAttacks = new WeakMap();
    const latestSnapshotPlayers = new Map();
    const spawnedAtMap = new Map();
    const prevAliveMap = new Map();
    const SPAWN_PROTECT_MS = 1500;

    function installSnapshotTracker() {
      if (enginePatched) {
        return;
      }

      enginePatched = true;
      const engineUrl = new URL('client/engine.js', location.href).href;

      import(engineUrl)
        .then(({ Engine }) => {
          const proto = Engine?.prototype;

          if (!proto || typeof proto.snapshot !== 'function' || proto.snapshot.__solsticeAuraSnapshotPatched) {
            return;
          }

          const originalSnapshot = proto.snapshot;
          const wrappedSnapshot = function wrappedAuraSnapshot(s, ...rest) {
            if (s && Array.isArray(s.players)) {
              const now = performance.now();
              latestSnapshotPlayers.clear();

              for (const p of s.players) {
                if (p && p.id != null) {
                  const alive = p.alive !== false;
                  const wasAlive = prevAliveMap.get(p.id);

                  if (alive && wasAlive === false) {
                    spawnedAtMap.set(p.id, now);
                  }

                  prevAliveMap.set(p.id, alive);

                  latestSnapshotPlayers.set(p.id, {
                    x: p.x,
                    y: p.y,
                    z: p.z,
                    vx: Number(p.vx) || 0,
                    vy: Number(p.vy) || 0,
                    vz: Number(p.vz) || 0,
                    crouch: Boolean(p.crouch),
                    sliding: Boolean(p.sliding),
                    alive,
                    at: now
                  });
                }
              }
            }

            return originalSnapshot.call(this, s, ...rest);
          };

          Object.defineProperty(wrappedSnapshot, '__solsticeAuraSnapshotPatched', { value: true });
          proto.snapshot = wrappedSnapshot;

          if (typeof proto.applyEvent === 'function' && !proto.applyEvent.__solsticeAuraEventPatched) {
            const originalApplyEvent = proto.applyEvent;
            const wrappedApplyEvent = function wrappedAuraApplyEvent(e, ...rest) {
              if (e && e.type === 'damage' && e.id === this.net?.id && e.attacker != null && e.attacker !== this.net?.id) {
                lastAttackerId = e.attacker;
                lastAttackerAt = performance.now();
              }

              return originalApplyEvent.call(this, e, ...rest);
            };

            Object.defineProperty(wrappedApplyEvent, '__solsticeAuraEventPatched', { value: true });
            proto.applyEvent = wrappedApplyEvent;
          }
        })
        .catch(() => {
          enginePatched = false;
        });
    }

    function releaseAds() {
      if (!syntheticAds) {
        return;
      }

      syntheticAds = false;

      if (bridge.physicalRmb) {
        return;
      }

      bridge.getGH()?.debug?.input?.keys?.delete('Mouse2');
    }

    function setAds(wanted) {
      const input = bridge.getGH()?.debug?.input;

      if (!wanted || !input?.keys) {
        releaseAds();
        return;
      }

      if (bridge.physicalRmb) {
        syntheticAds = false;
        return;
      }

      if (!input.keys.has('Mouse2')) {
        input.keys.add('Mouse2');
        syntheticAds = true;
      }
    }

    function applySilentAds() {
      if (!syntheticAds) {
        return;
      }

      const debug = bridge.getGH()?.debug;
      const player = debug?.player;
      const arsenal = debug?.arsenal;

      if (player) {
        player.adsK = 0;
        player.zoom = 1;
      }

      if (arsenal) {
        arsenal.ads = 0;
        arsenal.adsHeld = false;
      }
    }

    function resolveActorPose(actor) {
      if (!config.legacyAura && actor?.id != null) {
        const raw = typeof bridge.getRawPlayer === 'function' ? bridge.getRawPlayer(actor) : null;

        if (raw && raw.alive !== false) {
          const height = raw.sliding ? 0.95 : raw.crouch ? 1.2 : 1.8;
          const lead = Number(config.lead) || 0;
          return {
            x: raw.x + (Number(raw.vx) || 0) * lead,
            y: raw.y + (Number(raw.vy) || 0) * lead,
            z: raw.z + (Number(raw.vz) || 0) * lead,
            height
          };
        }

        const snap = latestSnapshotPlayers.get(actor.id);

        if (snap && snap.alive && performance.now() - snap.at < 1000) {
          const height = snap.sliding ? 0.95 : snap.crouch ? 1.2 : 1.8;
          const lead = Number(config.lead) || 0;
          return {
            x: snap.x + snap.vx * lead,
            y: snap.y + snap.vy * lead,
            z: snap.z + snap.vz * lead,
            height
          };
        }
      }

      const height = Number(actor?.e?.h) > 0.2 ? Number(actor.e.h) : 1.8;
      return { x: actor.pos.x, y: actor.pos.y, z: actor.pos.z, height };
    }

    function computeHeadPoint(actor, out, eye) {
      if (config.legacyAura) {
        bridge.headPoint(actor, out);
        return out;
      }

      const parts = actor.hit;

      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part?.part === 'head' && part.a && part.b) {
            out.set(
              (part.a.x + part.b.x) * 0.5,
              (part.a.y + part.b.y) * 0.5,
              (part.a.z + part.b.z) * 0.5
            );
            return out;
          }
        }
      }

      const pose = resolveActorPose(actor);
      let aimY = pose.height < 1.1 ? 0.65 : pose.height < 1.4 ? 1.0 : 1.62;

      if (eye) {
        const dist = Math.hypot(pose.x - eye.x, pose.y - eye.y, pose.z - eye.z);
        const drop = Math.min(0.08, dist * 0.0015);
        aimY = Math.max(pose.height * 0.55, aimY - drop);
      }

      out.set(pose.x, pose.y + aimY, pose.z);
      return out;
    }

    function aimPoint(actor, eye, debug) {
      const range = Number(config.range) || 0;
      const point = debug.player.pos.clone();
      computeHeadPoint(actor, point, eye);

      let dx = point.x - eye.x;
      let dy = point.y - eye.y;
      let dz = point.z - eye.z;

      if (Math.hypot(dx, dy, dz) <= range) {
        const visible = !config.wallCheck || bridge.worldLineClear(eye, point);

        if (visible) {
          return { x: point.x, y: point.y, z: point.z };
        }
      }

      const pose = config.legacyAura
        ? {
            x: actor.pos.x,
            y: actor.pos.y,
            z: actor.pos.z,
            height: Number(actor.e?.h) > 0.2 ? Number(actor.e.h) : 1.8
          }
        : resolveActorPose(actor);

      point.set(pose.x, pose.y + pose.height * 0.55, pose.z);
      dx = point.x - eye.x;
      dy = point.y - eye.y;
      dz = point.z - eye.z;

      if (
        Math.hypot(dx, dy, dz) <= range &&
        (!config.wallCheck || bridge.worldLineClear(eye, point))
      ) {
        return { x: point.x, y: point.y, z: point.z };
      }

      return null;
    }

    function isSpawnProtected(actor, debug) {
      if (!config.deprioritizeSpawn || !actor) {
        return false;
      }

      if (actor.id != null) {
        const spawnedAt = spawnedAtMap.get(actor.id);

        if (spawnedAt != null && performance.now() - spawnedAt < SPAWN_PROTECT_MS) {
          return true;
        }
      }

      const gameTime = typeof debug?.ctx?.time === 'function' ? debug.ctx.time() : null;

      if (gameTime !== null && typeof actor.spawnT === 'number' && gameTime - actor.spawnT < SPAWN_PROTECT_MS / 1000) {
        return true;
      }

      return false;
    }

    function selectTarget(context) {
      const { player, camera, debug, actors } = context;
      const eye = config.legacyAura ? camera.position : player.eye || camera.position;
      const range = Number(config.range) || 0;
      const head = player.pos.clone();
      const candidates = [];

      for (const actor of actors) {
        if (!bridge.isEnemy(actor, player)) {
          continue;
        }

        computeHeadPoint(actor, head, eye);

        const distance = Math.hypot(head.x - eye.x, head.y - eye.y, head.z - eye.z);

        if (distance > range) {
          continue;
        }

        candidates.push({ actor, distance, spawnProtected: isSpawnProtected(actor, debug) });
      }

      if (candidates.length === 0) {
        return null;
      }

      const attackerFresh =
        config.focusAttacker &&
        lastAttackerId != null &&
        performance.now() - lastAttackerAt < 3000;

      if (config.mode === 'Single') {
        candidates.sort((left, right) => {
          if (left.spawnProtected !== right.spawnProtected) {
            return left.spawnProtected ? 1 : -1;
          }

          return left.distance - right.distance;
        });

        if (singleTarget) {
          const currentIndex = candidates.findIndex((entry) => entry.actor === singleTarget);

          if (currentIndex > 0) {
            const [current] = candidates.splice(currentIndex, 1);
            candidates.unshift(current);
          }
        }

        if (attackerFresh) {
          const attackerIndex = candidates.findIndex((entry) => entry.actor?.id === lastAttackerId);

          if (attackerIndex >= 0) {
            const [attacker] = candidates.splice(attackerIndex, 1);
            candidates.unshift(attacker);
          }
        }
      } else {
        candidates.sort((left, right) => {
          if (attackerFresh) {
            const leftAttacker = left.actor?.id === lastAttackerId;
            const rightAttacker = right.actor?.id === lastAttackerId;

            if (leftAttacker !== rightAttacker) {
              return leftAttacker ? -1 : 1;
            }
          }

          if (left.spawnProtected !== right.spawnProtected) {
            return left.spawnProtected ? 1 : -1;
          }

          const leftTime = lastAttacks.get(left.actor) || 0;
          const rightTime = lastAttacks.get(right.actor) || 0;

          if (leftTime !== rightTime) {
            return leftTime - rightTime;
          }

          return left.distance - right.distance;
        });
      }

      for (const candidate of candidates) {
        const point = aimPoint(candidate.actor, eye, debug);

        if (!point) {
          continue;
        }

        if (config.mode === 'Single') {
          singleTarget = candidate.actor;
        }

        return { actor: candidate.actor, point };
      }

      return null;
    }

    function applyAura() {
      if (!config.enabled) {
        target = null;
        singleTarget = null;
        releaseAds();
        bridge.requestAutoFire('aura', false);
        return;
      }

      const context = bridge.getContext();

      if (!context) {
        target = null;
        singleTarget = null;
        releaseAds();
        bridge.requestAutoFire('aura', false);
        return;
      }

      const selected = selectTarget(context);

      if (!selected) {
        target = null;

        if (config.mode === 'Single') {
          singleTarget = null;
        }

        releaseAds();
        bridge.requestAutoFire('aura', false);
        return;
      }

      target = selected.actor;
      setAds(config.ads);
      applySilentAds();
      bridge.requestAutoFire('aura', true);
    }

    function resolveShot(eye, dir) {
      if (!config.enabled || !target || !bridge.active || bridge.uiOpen) {
        return null;
      }

      const debug = bridge.getGH()?.debug;
      const camera = debug?.gfx?.camera;
      const baseOrigin = eye || debug?.player?.eye || camera?.position;

      if (!baseOrigin || !debug) {
        return null;
      }

      let origin = baseOrigin;
      const slideDerp = typeof bridge.getFeature === 'function' ? bridge.getFeature('slidederp') : null;

      if (!config.legacyAura && debug.player?.pos) {
        const player = debug.player;
        const airborne = player.e && player.e.onGround === false;
        let localEyeHeight =
          player.mode === 'slide' ? 0.72 : player.stance === 'crouch' ? 1.0 : 1.62;

        if (
          slideDerp &&
          typeof slideDerp.isActive === 'function' &&
          slideDerp.isActive() &&
          slideDerp.isSilent()
        ) {
          localEyeHeight = slideDerp.getServerEyeHeight();
        }

        const airCompensateY = airborne ? -(Number(player.vel?.y) || 0) * 0.016 : 0;

        origin = {
          x: player.pos.x,
          y: player.pos.y + localEyeHeight + airCompensateY,
          z: player.pos.z
        };
      }

      const point = aimPoint(target, origin, debug);

      if (!point) {
        return null;
      }

      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const dz = point.z - origin.z;
      const length = Math.hypot(dx, dy, dz);

      if (length < 1e-4) {
        return null;
      }

      const out = dir && typeof dir.clone === 'function'
        ? dir.clone()
        : debug.player.pos.clone();

      const turnSpeed = Number(config.turnSpeed) || 1000;

      if (turnSpeed >= 1000) {
        aimYaw = Math.atan2(-dx, -dz);
        aimPitch = Math.asin(bridge.clamp(dy / length, -1, 1));
        out.x = dx / length;
        out.y = dy / length;
        out.z = dz / length;
        return out;
      }

      const targetYaw = Math.atan2(-dx, -dz);
      const targetPitch = Math.asin(bridge.clamp(dy / length, -1, 1));
      const now = performance.now();
      const dt = lastTurnAt ? Math.min(0.1, Math.max(0.001, (now - lastTurnAt) / 1000)) : 1 / 60;
      lastTurnAt = now;

      if (aimYaw === null || aimPitch === null) {
        aimYaw = Number(debug.player?.yaw) || targetYaw;
        aimPitch = Number(debug.player?.pitch) || targetPitch;
      }

      const maxStep = (turnSpeed * Math.PI / 180) * dt;
      const yawDiff = bridge.wrapAngle(targetYaw - aimYaw);
      const pitchDiff = targetPitch - aimPitch;
      const totalDiff = Math.hypot(yawDiff, pitchDiff);

      if (totalDiff <= maxStep || totalDiff < 1e-6) {
        aimYaw = targetYaw;
        aimPitch = targetPitch;
      } else {
        const scale = maxStep / totalDiff;
        aimYaw = bridge.wrapAngle(aimYaw + yawDiff * scale);
        aimPitch = bridge.clamp(aimPitch + pitchDiff * scale, -1.5, 1.5);
      }

      const cosPitch = Math.cos(aimPitch);
      out.x = -Math.sin(aimYaw) * cosPitch;
      out.y = Math.sin(aimPitch);
      out.z = -Math.cos(aimYaw) * cosPitch;
      return out;
    }

    function canFireNow() {
      if (!config.enabled || !target) {
        return false;
      }

      const debug = bridge.getGH()?.debug;
      const arsenal = debug?.arsenal;

      if (!arsenal || arsenal.state !== 'ready' || arsenal.cool > 0) {
        return false;
      }

      if ((arsenal.pumpWait || 0) > 0 || debug.player?.mode === 'mantle') {
        return false;
      }

      return (arsenal.slot?.ammo || 0) > 0;
    }

    function installSprintLock() {
      const arsenal = bridge.getGH()?.debug?.arsenal;

      if (!arsenal) {
        return;
      }

      if (
        typeof arsenal.blocksSprint === 'function' &&
        !arsenal.blocksSprint.__solsticeAuraSprintUnlock
      ) {
        const originalBlocksSprint = arsenal.blocksSprint;
        const wrappedBlocksSprint = function wrappedAuraBlocksSprint(...args) {
          if (!config.enabled) {
            return originalBlocksSprint.apply(this, args);
          }

          const sinceFire = this.sinceFire;
          this.sinceFire = 999;

          try {
            return originalBlocksSprint.apply(this, args);
          } finally {
            this.sinceFire = sinceFire;
          }
        };

        Object.defineProperty(wrappedBlocksSprint, '__solsticeAuraSprintUnlock', { value: true });
        arsenal.blocksSprint = wrappedBlocksSprint;
      }

      if (!arsenal.__solsticeAuraSprintLockPatched) {
        try {
          let storedSprintLock = Number(arsenal.sprintLock) || 0;

          Object.defineProperty(arsenal, 'sprintLock', {
            configurable: true,
            enumerable: true,
            get() {
              return config.enabled ? 0 : storedSprintLock;
            },
            set(value) {
              storedSprintLock = Number(value) || 0;
            }
          });

          Object.defineProperty(arsenal, '__solsticeAuraSprintLockPatched', { value: true });
        } catch {

        }
      }
    }

    bridge.onConfig('solstice-combat', (data) => {
      if (data.type !== 'config' || data.module !== 'aura') {
        return;
      }

      const range = Number(data.range);
      const lead = Number(data.lead);
      const turnSpeed = Number(data.turnSpeed);
      const mode = data.mode === 'Single' ? 'Single' : 'Switch';

      if (config.mode !== mode) {
        singleTarget = null;
      }

      config = {
        enabled: Boolean(data.enabled),
        mode,
        range: Number.isFinite(range) ? bridge.clamp(range, 0, 100) : 20,
        lead: Number.isFinite(lead) ? bridge.clamp(lead, 0, 0.25) : 0,
        turnSpeed: Number.isFinite(turnSpeed) ? bridge.clamp(turnSpeed, 60, 1000) : 1000,
        focusAttacker: data.focusAttacker !== false,
        deprioritizeSpawn: data.deprioritizeSpawn !== false,
        wallCheck: data.wallCheck !== false,
        ads: Boolean(data.ads),
        legacyAura: Boolean(data.legacyAura)
      };

      bridge.setRecoilSuppressed('aura', config.enabled);

      if (config.enabled) {
        installSnapshotTracker();
      } else {
        target = null;
        singleTarget = null;
        releaseAds();
        bridge.requestAutoFire('aura', false);
      }
    });

    bridge.onBeforePlayerUpdate(applyAura, 20);

    bridge.onAfterArsenalUpdate(applySilentAds, 20);

    bridge.onWorldMove((context) => {
      if (!syntheticAds || !context.input || !(context.input.buttons & 8)) {
        return;
      }

      if (context.localInput === context.input) {
        context.localInput = { ...context.input };
      }

      context.localInput.buttons &= ~8;
    }, 20);

    bridge.onCombatFire((actor, eye, dir) => {
      if (!config.enabled || !target || !bridge.active || bridge.uiOpen) {
        return null;
      }

      const redirected = resolveShot(eye, dir);

      if (!redirected) {
        return null;
      }

      lastAttacks.set(target, performance.now());
      return redirected;
    }, 10);

    bridge.provide('aura', {
      isSyntheticAds: () => syntheticAds,
      getTarget: () => target,
      canFireNow,
      getAimPoint: (eye) => {
        if (!target) {
          return null;
        }

        const debug = bridge.getGH()?.debug;
        return debug ? aimPoint(target, eye, debug) : null;
      }
    });

    bridge.onReset(() => {
      latestSnapshotPlayers.clear();
      spawnedAtMap.clear();
      prevAliveMap.clear();
      lastAttackerId = null;
      lastAttackerAt = 0;
      aimYaw = null;
      aimPitch = null;
      lastTurnAt = 0;
      releaseAds();
      bridge.requestAutoFire('aura', false);
    });

    installSnapshotTracker();
    installSprintLock();
    setInterval(installSprintLock, 500);
  }
})();
