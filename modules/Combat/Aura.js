(() => {
  'use strict';

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 100;
  const HEARTBEAT_MS = 500;

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

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
    const hitboxSetting = module.settings.find((entry) => entry.n === 'Hitbox');
    const hitbox = hitboxSetting?.vals?.[hitboxSetting.v] || 'Smart';
    const range = Math.max(0, Math.min(100, Number(setting(module, 'Range', 40)) || 0));
    const turnSpeed = Math.max(60, Math.min(1000, Number(setting(module, 'Turn Speed', 1000)) || 1000));

    const ignoreSpawn = Boolean(setting(module, 'Ignore Spawn', false));
    const ignoreSpawnTime = Math.max(0.05, Math.min(1.5, Number(setting(module, 'Ignore time', 0.75)) || 0.75));
    const ignoreSpawnTimeSetting = module.settings.find((entry) => entry.n === 'Ignore time');

    if (ignoreSpawnTimeSetting) {
      ignoreSpawnTimeSetting.vis = Boolean(ignoreSpawn);
    }

    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'aura',
      enabled: Boolean(module.on),
      mode,
      hitbox,
      range,
      turnSpeed,
      wallCheck: Boolean(setting(module, 'Wall Check', true)),
      focusAttacker: Boolean(setting(module, 'Focus Attacker', true)),
      deprioritizeSpawn: Boolean(setting(module, 'Deprioritize Spawn', true)),
      ignoreSpawn,
      ignoreSpawnTime,
      ads: Boolean(setting(module, 'ADS', false)),
      silentAds: Boolean(setting(module, 'Silent ADS', false))
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
    desc: 'Server-synced kill aura using authoritative snapshot ticks and world raycasts.',
    cat: 'Combat',
    nm: { l: 'aura', ls: 'aura', n: 'Aura', ns: 'Aura' },
    disp: 'Mode',
    settings: [
      {
        t: 'e',
        n: 'Mode',
        d: 'Switch cycles between targets; Single stays on one target until lost.',
        v: 0,
        vals: ['Switch', 'Single']
      },
      {
        t: 'e',
        n: 'Hitbox',
        d: 'Smart aims head first and falls back to visible body parts.',
        v: 0,
        vals: ['Smart', 'Head', 'Body']
      },
      {
        t: 'n',
        n: 'Range',
        d: 'Maximum attack distance in meters.',
        v: 40,
        min: 0,
        max: 100,
        step: 1
      },
      {
        t: 'n',
        n: 'Turn Speed',
        d: 'Aim rotation speed in deg/s (1000 = instant).',
        v: 1000,
        min: 60,
        max: 1000,
        step: 10
      },
      {
        t: 'b',
        n: 'Wall Check',
        d: 'Only attack targets with a clear line of sight in world geometry.',
        v: 1
      },
      {
        t: 'b',
        n: 'Focus Attacker',
        d: 'Prioritizes enemies who recently damaged you.',
        v: 1
      },
      {
        t: 'b',
        n: 'Deprioritize Spawn',
        d: 'Lowers priority of newly spawned enemies (1.5s).',
        v: 1
      },
      {
        t: 'b',
        n: 'Ignore Spawn',
        d: 'Completely ignores newly spawned enemies for a set duration.',
        v: 0
      },
      {
        t: 'n',
        n: 'Ignore time',
        d: 'Duration in seconds to ignore newly spawned enemies.',
        v: 0.75,
        min: 0.05,
        max: 1.5,
        step: 0.05
      },
      {
        t: 'b',
        n: 'ADS',
        d: 'Automatically aim down sights while attacking.',
        v: 0
      },
      {
        t: 'b',
        n: 'Silent ADS',
        d: 'Keep server ADS accuracy without zooming your local camera.',
        v: 0
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
    const ATTACKER_TTL_MS = 3500;
    const SPAWN_PROTECT_MS = 1500;

    let config = {
      enabled: false,
      mode: 'Switch',
      hitbox: 'Smart',
      range: 40,
      turnSpeed: 1000,
      wallCheck: true,
      focusAttacker: true,
      deprioritizeSpawn: true,
      ignoreSpawn: false,
      ignoreSpawnTime: 0.75,
      ads: false,
      silentAds: false,
      backtrack: true
    };

    let target = null;
    let targetTick = null;
    let targetInfo = null;
    let lockedAttackerId = null;
    let lastHealth = null;
    let engineHooked = false;
    let syntheticAds = false;
    const recentAttackers = new Map();
    const spawnedAtMap = new Map();
    const prevAliveMap = new Map();

    function installSnapshotTracker() {
      if (engineHooked) {
        return;
      }

      engineHooked = true;
      const engineUrl = new URL('client/engine.js', location.href).href;

      import(engineUrl)
        .then(({ Engine }) => {
          const proto = Engine?.prototype;

          if (!proto) {
            return;
          }

          if (typeof proto.snapshot === 'function' && !proto.snapshot.__solsticeNewAuraPatched) {
            const originalSnapshot = proto.snapshot;
            const wrappedSnapshot = function wrappedNewAuraSnapshot(s, ...rest) {
              if (s && Array.isArray(s.players)) {
                const now = performance.now();

                for (const p of s.players) {
                  if (p && p.id != null) {
                    const alive = p.alive !== false;
                    const wasAlive = prevAliveMap.get(p.id);

                    if (alive && wasAlive === false) {
                      spawnedAtMap.set(p.id, now);
                    }

                    if (!alive) {
                      recentAttackers.delete(p.id);

                      if (p.id === lockedAttackerId) {
                        lockedAttackerId = null;
                      }
                    }

                    prevAliveMap.set(p.id, alive);
                  }
                }
              }

              return originalSnapshot.call(this, s, ...rest);
            };

            Object.defineProperty(wrappedSnapshot, '__solsticeNewAuraPatched', { value: true });
            proto.snapshot = wrappedSnapshot;
          }

          if (typeof proto.applyEvent === 'function' && !proto.applyEvent.__solsticeNewAuraEventPatched) {
            const originalApplyEvent = proto.applyEvent;
            const wrappedApplyEvent = function wrappedNewAuraApplyEvent(e, ...rest) {
              if (
                e &&
                e.type === 'damage' &&
                this.net?.id != null &&
                e.id === this.net.id &&
                e.attacker != null &&
                e.attacker !== this.net.id
              ) {
                recentAttackers.set(e.attacker, performance.now() + ATTACKER_TTL_MS);
              }

              return originalApplyEvent.call(this, e, ...rest);
            };

            Object.defineProperty(wrappedApplyEvent, '__solsticeNewAuraEventPatched', { value: true });
            proto.applyEvent = wrappedApplyEvent;
          }
        })
        .catch(() => {
          engineHooked = false;
        });
    }

    function eyeHeightFor(sliding, crouch) {
      return sliding ? 0.72 : crouch ? 1.0 : 1.62;
    }

    function resolveShooterOrigin(debug, engineState) {
      const player = debug?.player;
      const predicted = engineState?.predicted;
      const rawSelf = typeof bridge.getRawSelf === 'function' ? bridge.getRawSelf() : null;
      const hasRawSelf = Boolean(rawSelf && rawSelf.alive !== false);
      const slideDerp = typeof bridge.getFeature === 'function' ? bridge.getFeature('slidederp') : null;
      const silentSlide = Boolean(
        slideDerp &&
        typeof slideDerp.isActive === 'function' &&
        slideDerp.isActive() &&
        slideDerp.isSilent()
      );

      if (hasRawSelf && predicted) {
        const desync = Math.hypot(predicted.x - rawSelf.x, predicted.y - rawSelf.y, predicted.z - rawSelf.z);

        if (desync > 0.15) {
          const eyeH = silentSlide
            ? slideDerp.getServerEyeHeight()
            : eyeHeightFor(rawSelf.sliding, rawSelf.crouch);
          return { x: rawSelf.x, y: rawSelf.y + eyeH, z: rawSelf.z };
        }
      }

      if (predicted) {
        const eyeH = silentSlide
          ? slideDerp.getServerEyeHeight()
          : eyeHeightFor(predicted.sliding, predicted.crouch);
        return { x: predicted.x, y: predicted.y + eyeH, z: predicted.z };
      }

      if (hasRawSelf) {
        const eyeH = silentSlide
          ? slideDerp.getServerEyeHeight()
          : eyeHeightFor(rawSelf.sliding, rawSelf.crouch);
        return { x: rawSelf.x, y: rawSelf.y + eyeH, z: rawSelf.z };
      }

      if (player?.pos) {
        const eyeH = silentSlide
          ? slideDerp.getServerEyeHeight()
          : eyeHeightFor(player.mode === 'slide', player.stance === 'crouch');
        return { x: player.pos.x, y: player.pos.y + eyeH, z: player.pos.z };
      }

      return debug?.gfx?.camera?.position || null;
    }

    function resolveTargetBase(actor) {
      const raw = typeof bridge.getRawPlayer === 'function' ? bridge.getRawPlayer(actor) : null;

      if (raw && raw.alive !== false) {
        const height = raw.sliding ? 0.95 : raw.crouch ? 1.2 : 1.8;
        return { x: raw.x, y: raw.y, z: raw.z, height };
      }

      if (!actor?.pos) {
        return null;
      }

      const height = Number(actor.e?.h) > 0.2 ? Number(actor.e.h) : 1.8;
      return { x: actor.pos.x, y: actor.pos.y, z: actor.pos.z, height };
    }

    function isLineClear(world, origin, point) {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const dz = point.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist <= 0.15) {
        return true;
      }

      if (world && typeof world.raycast === 'function') {
        const hit = world.raycast(origin, { x: dx / dist, y: dy / dist, z: dz / dist }, dist);
        return !hit || hit.distance <= 0.05 || hit.distance >= dist - 0.08;
      }

      return bridge.worldLineClear(origin, point);
    }

    function candidatePoints(base) {
      const headY = base.y + base.height - 0.17;
      const chestY = base.y + base.height * 0.68;
      const centerY = base.y + base.height * 0.50;
      const lowerY = base.y + Math.max(0.25, base.height * 0.34);

      const headPts = [
        { x: base.x, y: headY, z: base.z },
        { x: base.x + 0.10, y: headY, z: base.z },
        { x: base.x - 0.10, y: headY, z: base.z },
        { x: base.x, y: headY, z: base.z + 0.10 },
        { x: base.x, y: headY, z: base.z - 0.10 }
      ];

      const bodyPts = [
        { x: base.x, y: chestY, z: base.z },
        { x: base.x, y: centerY, z: base.z },
        { x: base.x + 0.16, y: centerY, z: base.z },
        { x: base.x - 0.16, y: centerY, z: base.z },
        { x: base.x, y: centerY, z: base.z + 0.16 },
        { x: base.x, y: centerY, z: base.z - 0.16 },
        { x: base.x, y: lowerY, z: base.z }
      ];

      if (config.hitbox === 'Head') {
        return headPts;
      }

      if (config.hitbox === 'Body') {
        return bodyPts;
      }

      return headPts.concat(bodyPts);
    }

    function pickBestAimPointForBase(base, origin, world) {
      if (!base) {
        return null;
      }

      const points = candidatePoints(base);

      if (!config.wallCheck) {
        return points[0];
      }

      for (const pt of points) {
        if (isLineClear(world, origin, pt)) {
          return pt;
        }
      }

      return null;
    }

    function pickBestAimPoint(actor, origin, world) {
      return pickBestAimPointForBase(resolveTargetBase(actor), origin, world);
    }

    function pickBestTargetShot(actor, origin, world, range) {
      const currentPt = pickBestAimPoint(actor, origin, world);

      if (currentPt) {
        const dist = Math.hypot(currentPt.x - origin.x, currentPt.y - origin.y, currentPt.z - origin.z);

        if (dist <= range) {
          return { point: currentPt, tick: null, backtrackMs: 0, distance: dist };
        }
      }

      const bt = typeof bridge.getFeature === 'function' ? bridge.getFeature('backtrack') : null;

      if (!bt || typeof bt.findExposedShot !== 'function') {
        return null;
      }

      return bt.findExposedShot(actor, origin, world, range, (base) => pickBestAimPointForBase(base, origin, world));
    }

    function isSpawnIgnored(actor, now = performance.now()) {
      if (!config.ignoreSpawn || !actor || actor.id == null) {
        return false;
      }

      const spawnedAt = spawnedAtMap.get(actor.id);
      return spawnedAt != null && (now - spawnedAt) < config.ignoreSpawnTime * 1000;
    }

    function isIrcProtected(actor) {
      const irc = typeof bridge.getFeature === 'function' ? bridge.getFeature('irc') : null;
      return Boolean(irc && typeof irc.isProtected === 'function' && irc.isProtected(actor));
    }

    function recordAttackers(player, actors) {
      if (!player || !Array.isArray(actors)) {
        return;
      }

      const now = performance.now();

      for (const [id, expiry] of recentAttackers) {
        if (expiry <= now) {
          recentAttackers.delete(id);
        }
      }

      const hp = Number(player.health);

      if (!Number.isFinite(hp)) {
        return;
      }

      if (lastHealth !== null && hp < lastHealth) {
        let best = null;
        let bestScore = Infinity;

        for (const actor of actors) {
          if (!bridge.isEnemy(actor, player) || actor.id == null) {
            continue;
          }

          const dist = Math.hypot(
            actor.pos.x - player.pos.x,
            actor.pos.y - player.pos.y,
            actor.pos.z - player.pos.z
          );

          if (dist < bestScore) {
            bestScore = dist;
            best = actor;
          }
        }

        if (best) {
          recentAttackers.set(best.id, now + ATTACKER_TTL_MS);
        }
      }

      lastHealth = hp;
    }

    function selectTarget(context, origin, world) {
      const { player, actors } = context;
      const range = Number(config.range) || 0;
      const now = performance.now();
      const candidates = [];

      for (const actor of actors) {
        if (!bridge.isEnemy(actor, player) || isIrcProtected(actor) || isSpawnIgnored(actor, now)) {
          continue;
        }

        const shot = pickBestTargetShot(actor, origin, world, range);

        if (!shot) {
          continue;
        }

        const attacker = config.focusAttacker && actor.id != null && (recentAttackers.get(actor.id) || 0) > now;
        const spawnedAt = actor.id != null ? spawnedAtMap.get(actor.id) : null;
        const freshSpawn = config.deprioritizeSpawn && spawnedAt != null && (now - spawnedAt) < SPAWN_PROTECT_MS;

        candidates.push({
          actor,
          point: shot.point,
          tick: shot.tick,
          backtrackMs: shot.backtrackMs,
          distance: shot.distance,
          attacker,
          freshSpawn
        });
      }

      if (candidates.length === 0) {
        return null;
      }

      if (config.focusAttacker && lockedAttackerId != null) {
        const locked = candidates.find((entry) => entry.actor?.id === lockedAttackerId);

        if (locked) {
          return locked;
        }
      }

      candidates.sort((a, b) => {
        if (a.attacker !== b.attacker) {
          return a.attacker ? -1 : 1;
        }

        if (a.freshSpawn !== b.freshSpawn) {
          return a.freshSpawn ? 1 : -1;
        }

        return a.distance - b.distance;
      });

      if (config.focusAttacker && candidates[0].attacker && candidates[0].actor?.id != null) {
        lockedAttackerId = candidates[0].actor.id;
        return candidates[0];
      }

      if (config.mode === 'Single' && target) {
        const sticky = candidates.find((entry) => entry.actor === target);

        if (sticky) {
          return sticky;
        }
      }

      return candidates[0];
    }

    function aimAngles(origin, point) {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const dz = point.z - origin.z;
      const horiz = Math.hypot(dx, dz);

      if (horiz < 1e-6 && Math.abs(dy) < 1e-6) {
        return null;
      }

      return {
        yaw: Math.atan2(-dx, -dz),
        pitch: bridge.clamp(Math.atan2(dy, horiz), -1.49, 1.49)
      };
    }

    function stepAngle(current, desired, maxDelta) {
      const diff = bridge.wrapAngle(desired - current);

      if (Math.abs(diff) <= maxDelta) {
        return desired;
      }

      return current + Math.sign(diff) * maxDelta;
    }

    function releaseAds() {
      if (!syntheticAds) {
        return;
      }

      syntheticAds = false;

      if (!bridge.physicalRmb) {
        bridge.getGH()?.debug?.input?.keys?.delete('Mouse2');
      }
    }

    function setAds(wanted) {
      if (!wanted) {
        releaseAds();
        return;
      }

      const input = bridge.getGH()?.debug?.input;

      if (!input || !input.keys) {
        syntheticAds = false;
        return;
      }

      if (!bridge.physicalRmb) {
        input.keys.add('Mouse2');
        syntheticAds = true;
      }
    }

    function applySilentAds() {
      if (!syntheticAds || !config.silentAds) {
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

    function clearCombatState() {
      target = null;
      targetTick = null;
      targetInfo = null;
      lockedAttackerId = null;
      lastHealth = null;
      releaseAds();
      bridge.requestAutoFire('aura', false);
      if (typeof bridge.setShotTickOverride === 'function') {
        bridge.setShotTickOverride(null);
      }
    }

    installSnapshotTracker();
    installSprintLock();
    setInterval(installSprintLock, 500);

    bridge.onBeforePlayerUpdate((dt) => {
      if (!config.enabled || !bridge.active || bridge.uiOpen) {
        clearCombatState();
        return;
      }

      const context = bridge.getContext();

      if (!context || !context.player?.alive) {
        clearCombatState();
        return;
      }

      const engineState = typeof bridge.getEngineState === 'function' ? bridge.getEngineState() : null;
      const origin = resolveShooterOrigin(context.debug, engineState);

      if (!origin) {
        clearCombatState();
        return;
      }

      recordAttackers(context.player, context.actors);

      const picked = selectTarget(context, origin, engineState?.world || null);

      if (!picked) {
        target = null;
        targetTick = null;
        targetInfo = null;
        releaseAds();
        bridge.requestAutoFire('aura', false);
        if (typeof bridge.setShotTickOverride === 'function') {
          bridge.setShotTickOverride(null);
        }
        return;
      }

      target = picked.actor;
      targetTick = picked.tick;
      targetInfo = {
        name: String(picked.actor?.name || 'Enemy'),
        health: Math.max(0, Math.min(100, Math.round(Number(picked.actor?.health ?? 100)))),
        distance: Math.round(picked.distance * 10) / 10,
        backtrackMs: picked.backtrackMs || 0
      };
      setAds(config.ads);
      applySilentAds();

      if (config.turnSpeed < 999) {
        const angles = aimAngles(origin, picked.point);

        if (angles) {
          const maxStep = (config.turnSpeed * Math.PI / 180) * Math.max(0.001, Math.min(dt || 0.016, 0.05));
          context.player.yaw = stepAngle(context.player.yaw, angles.yaw, maxStep);
          context.player.pitch = bridge.clamp(
            stepAngle(context.player.pitch, angles.pitch, maxStep),
            -1.49,
            1.49
          );
        }
      }

      bridge.requestAutoFire('aura', true);
    }, 30);

    bridge.onAfterArsenalUpdate(applySilentAds, 20);

    bridge.onWorldMove((context) => {
      if (!syntheticAds || !config.silentAds || !context.input || !(context.input.buttons & 8)) {
        return;
      }

      if (context.localInput === context.input) {
        context.localInput = { ...context.input };
      }

      context.localInput.buttons &= ~8;
    }, 20);

    bridge.onCombatFire((actor) => {
      if (!config.enabled || !target || !bridge.active || bridge.uiOpen) {
        return null;
      }

      const debug = bridge.getGH()?.debug;

      if (!debug?.player || actor !== debug.player || !debug.player.alive) {
        return null;
      }

      if (!bridge.isEnemy(target, debug.player) || isIrcProtected(target) || isSpawnIgnored(target)) {
        return null;
      }

      const engineState = typeof bridge.getEngineState === 'function' ? bridge.getEngineState() : null;
      const origin = resolveShooterOrigin(debug, engineState);

      if (!origin) {
        return null;
      }

      const shot = pickBestTargetShot(target, origin, engineState?.world || null, Number(config.range) || 0);

      if (!shot?.point) {
        return null;
      }

      if (typeof bridge.setShotTickOverride === 'function') {
        bridge.setShotTickOverride(shot.tick, 120);
      }

      const dx = shot.point.x - origin.x;
      const dy = shot.point.y - origin.y;
      const dz = shot.point.z - origin.z;
      const length = Math.hypot(dx, dy, dz);

      if (length < 1e-4) {
        return null;
      }

      return {
        x: dx / length,
        y: dy / length,
        z: dz / length
      };
    }, 10);

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'aura') {
        return;
      }

      config = {
        enabled: Boolean(data.enabled),
        mode: data.mode === 'Single' ? 'Single' : 'Switch',
        hitbox: data.hitbox === 'Head' || data.hitbox === 'Body' ? data.hitbox : 'Smart',
        range: Math.max(0, Math.min(100, Number(data.range) || 0)),
        turnSpeed: Math.max(60, Math.min(1000, Number(data.turnSpeed) || 1000)),
        wallCheck: data.wallCheck !== false,
        focusAttacker: data.focusAttacker !== false,
        deprioritizeSpawn: data.deprioritizeSpawn !== false,
        ignoreSpawn: Boolean(data.ignoreSpawn),
        ignoreSpawnTime: Math.max(0.05, Math.min(1.5, Number(data.ignoreSpawnTime) || 0.75)),
        ads: Boolean(data.ads),
        silentAds: Boolean(data.silentAds)
      };

      if (!config.ads) {
        releaseAds();
      }

      if (!config.enabled) {
        clearCombatState();
      }

      bridge.setRecoilSuppressed('aura', config.enabled);
    });

    bridge.provide('aura', {
      isSyntheticAds: () => syntheticAds,
      getTarget: () => target,
      getTargetInfo: () => targetInfo,
      canFireNow,
      getAimPoint: (eye) => {
        if (!target) {
          return null;
        }

        const debug = bridge.getGH()?.debug;
        const engineState = typeof bridge.getEngineState === 'function' ? bridge.getEngineState() : null;
        const origin = eye || resolveShooterOrigin(debug, engineState);

        if (!origin) {
          return null;
        }

        const pt = pickBestAimPoint(target, origin, engineState?.world || null);
        return pt && debug?.player?.pos ? debug.player.pos.clone().set(pt.x, pt.y, pt.z) : null;
      }
    });

    bridge.onReset(clearCombatState);
  }
})();
