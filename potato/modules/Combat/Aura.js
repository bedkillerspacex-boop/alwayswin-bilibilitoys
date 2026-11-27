

(() => {
  'use strict';

  const CHANNEL = 'solstice-combat';

  if (location.hostname === 'www.bilibilitoy.com' && (location.pathname.startsWith('/toy/golden-hour/') || location.pathname.startsWith('/toy/potatoepic/'))) {
    bootGame();
    return;
  }

  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const gamePrefix = () => (document.documentElement?.getAttribute('data-solstice-game') === 'potatoepic' || location.pathname.includes('/potatoepic/')) ? '/toy/potatoepic/' : '/toy/golden-hour/';
  const potato = window.SolsticeGameId === 'potatoepic' || location.pathname.includes('/potatoepic/');
  const MIN_SEND_INTERVAL_MS = 100;
  const HEARTBEAT_MS = 500;

  let lastSentKey = '';
  let lastSentAt = 0;
  let cachedFrame = null;

  function findGameFrame() {
    if (cachedFrame?.isConnected &&
        cachedFrame.src.startsWith(`${GAME_ORIGIN}${gamePrefix()}`)) {
      return cachedFrame;
    }

    cachedFrame = null;

    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}${gamePrefix()}`)) {
        cachedFrame = frame;
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
    const modeValue = modeSetting?.vals?.[modeSetting.v];
    const mode = potato
      ? (['Single', 'Multi', 'Switch'].includes(modeValue) ? modeValue : 'Switch')
      : (modeValue === 'Single' ? 'Single' : 'Switch');
    const range = Math.max(0, Math.min(potato ? 1000 : 120, Number(setting(module, 'Range', 20)) || 0));
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'aura',
      enabled: Boolean(module.on),
      mode,
      range
    };

    if (potato) {
      config.attackThroughWalls = Boolean(setting(module, 'Attack through walls', true));
    } else {
      config.wallCheck = Boolean(setting(module, 'Wall Check', true));
      config.ads = Boolean(setting(module, 'ADS', false));
    }
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

  const settings = [
    {
      t: 'e',
      n: 'Mode',
      d: 'Switch cycles between targets; Single stays on one target until it is lost.',
      v: 0,
      vals: ['Switch', 'Single']
    },
    {
      t: 'n',
      n: 'Range',
      d: 'The range at which to attack enemies.',
      v: 20,
      min: 0,
      max: potato ? 1000 : 120,
      step: 0.5
    }
  ];

  if (potato) {
    const auraMode = settings.find((entry) => entry.n === 'Mode');

    if (auraMode) {
      auraMode.d = 'Single stays on one target; Multi fires one shot at every target in range; Switch cycles after each attack.';
      auraMode.v = 2;
      auraMode.vals = ['Single', 'Multi', 'Switch'];
    }

    settings.push({
      t: 'b',
      n: 'Attack through walls',
      d: 'Whether or not to attack through walls',
      v: 1
    });
  } else {
    settings.push(
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
      }
    );
  }

  register({
    name: 'Aura',
    desc: 'Automatically attacks nearby enemies.',
    cat: "Combat",
    nm: { l: 'aura', ls: 'aura', n: 'Aura', ns: 'Aura' },
    disp: 'Mode',
    settings,
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
    if (bridge.game === 'potatoepic') {
      installPotatoAura(bridge);
      return;
    }

    let config = {
      enabled: false,
      mode: 'Switch',
      range: 20,
      wallCheck: true,
      ads: false
    };
    let target = null;
    let singleTarget = null;
    let syntheticAds = false;
    const lastAttacks = new WeakMap();
    const remoteTracks = new WeakMap();
    const LEAD_SECONDS = 0.1;
    let latestSnapshot = null;
    let latestSnapshotPlayers = new Map();
    let aimScratch = null;
    let cachedAim = null;

    function currentSnapshot() {
      const snapshot = bridge.getRawSnapshot?.();

      if (!snapshot?.players) {
        return latestSnapshot;
      }

      if (!latestSnapshot ||
          (Number(snapshot.tick) || 0) >= (Number(latestSnapshot.tick) || 0) ||
          (Number(snapshot.time) || 0) > (Number(latestSnapshot.time) || 0)) {
        latestSnapshot = snapshot;
        latestSnapshotPlayers.clear();

        for (const player of snapshot.players) {
          latestSnapshotPlayers.set(player.id, player);
        }
      }

      return latestSnapshot;
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

    function rawPlayer(actor) {
      currentSnapshot();

      if (!latestSnapshot || !actor || actor.id === undefined) {
        return null;
      }

      return latestSnapshotPlayers.get(actor.id) || null;
    }

    function rawSelf() {
      currentSnapshot();

      const debug = bridge.getGH()?.debug;
      const player = debug?.player;

      if (!player || !latestSnapshot) {
        return null;
      }

      return latestSnapshotPlayers.get(player.id) || null;
    }

    function rawSelfEye() {
      const me = rawSelf();

      if (!me) {
        return null;
      }

      const eyeHeight = me.sliding ? 0.72 : me.crouch ? 1 : 1.62;
      return { x: me.x, y: me.y + eyeHeight, z: me.z };
    }

    function rawHeight(player) {
      return player.sliding ? 0.95 : player.crouch ? 1.2 : 1.8;
    }

    function rawHeadPoint(actor, out) {
      const player = rawPlayer(actor);

      if (!player || player.alive === false || !actor?.pos || typeof bridge.headPoint !== 'function') {
        return false;
      }

      bridge.headPoint(actor, out);

      out.set(
        player.x + (out.x - actor.pos.x),
        player.y + (out.y - actor.pos.y),
        player.z + (out.z - actor.pos.z)
      );
      return true;
    }

    function isRemoteActor(actor) {
      return Boolean(
        actor &&
        document.body.classList.contains('online-session') &&
        actor.isPlayer !== true &&
        !actor.char &&
        !Array.isArray(actor.hit)
      );
    }

    function remoteLeadOffset(actor) {
      if (!isRemoteActor(actor) || !actor.pos) {
        return null;
      }

      const now = performance.now();
      const previous = remoteTracks.get(actor);

      if (!previous) {
        remoteTracks.set(actor, {
          x: actor.pos.x,
          y: actor.pos.y,
          z: actor.pos.z,
          time: now,
          vx: 0,
          vy: 0,
          vz: 0
        });
        return null;
      }

      const dt = (now - previous.time) / 1000;
      const mx = actor.pos.x - previous.x;
      const my = actor.pos.y - previous.y;
      const mz = actor.pos.z - previous.z;

      if (dt >= 0.004 && dt <= 0.25) {
        if (Math.hypot(mx, my, mz) > 3.5) {
          previous.vx = 0;
          previous.vy = 0;
          previous.vz = 0;
        } else {
          const vx = Math.max(-18, Math.min(18, mx / dt));
          const vy = Math.max(-18, Math.min(18, my / dt));
          const vz = Math.max(-18, Math.min(18, mz / dt));
          previous.vx = previous.vx * 0.6 + vx * 0.4;
          previous.vy = previous.vy * 0.6 + vy * 0.4;
          previous.vz = previous.vz * 0.6 + vz * 0.4;
        }

        previous.x = actor.pos.x;
        previous.y = actor.pos.y;
        previous.z = actor.pos.z;
        previous.time = now;
      }

      return {
        x: previous.vx * LEAD_SECONDS,
        y: previous.vy * LEAD_SECONDS,
        z: previous.vz * LEAD_SECONDS
      };
    }

    function targetValid(context) {
      const raw = rawPlayer(target);

      return Boolean(
        target &&
        context &&
        target.alive !== false &&
        (!raw || raw.alive !== false) &&
        context.actors.includes(target) &&
        bridge.isEnemy(target, context.player)
      );
    }

    function aimPoint(actor, eye, debug) {
      const range = Number(config.range) || 0;
      const rangeSq = range * range;
      const raw = rawPlayer(actor);
      const lead = raw ? null : remoteLeadOffset(actor);
      const point = aimScratch || (aimScratch = debug.player.pos.clone());

      if (!rawHeadPoint(actor, point)) {
        bridge.headPoint(actor, point);

        if (lead) {
          point.x += lead.x;
          point.y += lead.y;
          point.z += lead.z;
        }
      }

      let dx = point.x - eye.x;
      let dy = point.y - eye.y;
      let dz = point.z - eye.z;

      if (dx * dx + dy * dy + dz * dz <= rangeSq) {
        const visible = !config.wallCheck || bridge.worldLineClear(eye, point);

        if (visible) {
          return { x: point.x, y: point.y, z: point.z };
        }
      }

      if (raw) {
        point.set(raw.x, raw.y + rawHeight(raw) * 0.55, raw.z);
      } else {
        const height = Number(actor.e?.h) > 0.2 ? Number(actor.e.h) : 1.8;
        point.set(actor.pos.x, actor.pos.y + height * 0.55, actor.pos.z);

        if (lead) {
          point.x += lead.x;
          point.y += lead.y;
          point.z += lead.z;
        }
      }

      dx = point.x - eye.x;
      dy = point.y - eye.y;
      dz = point.z - eye.z;

      if (
        dx * dx + dy * dy + dz * dz <= rangeSq &&
        (!config.wallCheck || bridge.worldLineClear(eye, point))
      ) {
        return { x: point.x, y: point.y, z: point.z };
      }

      return null;
    }

    function selectTarget(context) {
      const { player, camera, debug, actors } = context;
      const eye = rawSelfEye() || camera.position;
      const range = Number(config.range) || 0;
      const rangeSq = range * range;
      const head = aimScratch || (aimScratch = player.pos.clone());
      const candidates = [];

      for (const actor of actors) {
        if (!bridge.isEnemy(actor, player)) {
          continue;
        }

        const raw = rawPlayer(actor);

        if (raw && raw.alive === false) {
          continue;
        }

        if (!rawHeadPoint(actor, head)) {
          bridge.headPoint(actor, head);
        }

        const dx = head.x - eye.x;
        const dy = head.y - eye.y;
        const dz = head.z - eye.z;
        const distance = dx * dx + dy * dy + dz * dz;

        if (distance > rangeSq) {
          continue;
        }

        candidates.push({ actor, distance });
      }

      if (candidates.length === 0) {
        return null;
      }

      if (config.mode === 'Single') {
        candidates.sort((left, right) => left.distance - right.distance);

        if (singleTarget) {
          const currentIndex = candidates.findIndex((entry) => entry.actor === singleTarget);

          if (currentIndex > 0) {
            const [current] = candidates.splice(currentIndex, 1);
            candidates.unshift(current);
          }
        }
      } else {
        candidates.sort((left, right) => {
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
        cachedAim = null;
        releaseAds();
        bridge.requestAutoFire('aura', false);
        return;
      }

      const context = bridge.getContext();

      if (!context) {
        target = null;
        singleTarget = null;
        cachedAim = null;
        releaseAds();
        bridge.requestAutoFire('aura', false);
        return;
      }

      const selected = selectTarget(context);

      if (!selected) {
        target = null;
        cachedAim = null;

        if (config.mode === 'Single') {
          singleTarget = null;
        }

        releaseAds();
        bridge.requestAutoFire('aura', false);
        return;
      }

      target = selected.actor;
      cachedAim = {
        actor: selected.actor,
        point: selected.point,
        tick: Number(currentSnapshot()?.tick) || 0
      };
      setAds(config.ads);
      applySilentAds();
      bridge.requestAutoFire('aura', true);
    }

    function resolveShot(eye, dir) {
      const auto = Boolean(bridge.hasAutoFireRequest?.('aura'));

      if (!config.enabled || !target || !bridge.active || bridge.uiOpen) {
        bridge.requestAutoFire('aura', false);
        return auto ? false : null;
      }

      const context = bridge.getContext();

      if (!targetValid(context)) {
        target = null;
        bridge.requestAutoFire('aura', false);
        return auto ? false : null;
      }

      const camera = bridge.getGH()?.debug?.gfx?.camera;
      const thirdPerson = bridge.getFeature('thirdperson');
      const rawOrigin = rawSelfEye();
      const shotTick = Number(currentSnapshot()?.tick) || 0;
      const origin = rawOrigin || thirdPerson?.getEye?.() || eye || camera?.position;

      if (!origin) {
        bridge.requestAutoFire('aura', false);
        return auto ? false : null;
      }

      const point = cachedAim && cachedAim.actor === target &&
        cachedAim.tick === (Number(currentSnapshot()?.tick) || 0)
        ? cachedAim.point
        : aimPoint(target, origin, bridge.getGH().debug);

      if (!point) {
        bridge.requestAutoFire('aura', false);
        return auto ? false : null;
      }

      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const dz = point.z - origin.z;
      const length = Math.hypot(dx, dy, dz);

      if (length < 1e-4) {
        bridge.requestAutoFire('aura', false);
        return auto ? false : null;
      }

      const out = dir && typeof dir.clone === 'function'
        ? dir.clone()
        : bridge.getGH().debug.player.pos.clone();

      out.x = dx / length;
      out.y = dy / length;
      out.z = dz / length;
      if (shotTick > 0) bridge.setShotSnapshot?.(rawOrigin || origin, shotTick);
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
      const mode = data.mode === 'Single' ? 'Single' : 'Switch';

      if (config.mode !== mode) {
        singleTarget = null;
      }

      config = {
        enabled: Boolean(data.enabled),
        mode,
        range: Number.isFinite(range) ? bridge.clamp(range, 0, bridge.game === 'potatoepic' ? 1000 : 120) : 20,
        wallCheck: data.wallCheck !== false,
        ads: Boolean(data.ads)
      };

      bridge.setRecoilSuppressed('aura', config.enabled);

      if (!config.enabled) {
        target = null;
        singleTarget = null;
        cachedAim = null;
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
      const auto = Boolean(bridge.hasAutoFireRequest?.('aura'));

      if (!config.enabled || !bridge.active || bridge.uiOpen) {
        return auto ? false : null;
      }

      if (!target) {
        return auto ? false : null;
      }

      const redirected = resolveShot(eye, dir);

      if (!redirected) {
        if (auto) {
          bridge.requestAutoFire('aura', false);
          return false;
        }

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
      releaseAds();
        bridge.requestAutoFire('aura', false);
    });

    installSprintLock();
    setInterval(installSprintLock, 500);
  }

  function installPotatoAura(bridge) {
    let enabled = false;
    let config = {
      mode: 'Switch',
      range: 20,
      attackThroughWalls: true
    };
    let target = null;
    let singleTarget = null;
    let aimScratch = null;
    let renderAim = null;
    let aimPoint = null;
    let aimYaw = null;
    let aimPitch = null;
    let aimStamp = 0;
    let multiVolley = false;
    let originalGetBlock = null;
    let propsPlayer = null;
    let fireHooksInstalled = false;
    let auraMouseForced = false;
    let auraMouseSaved = false;
    let auraMouseGame = null;
    let triggerHookInstalled = false;
    let renderHookInstalled = false;

    function playerOrigin(player) {
      try {
        const actual = window.game?.player;
        const eye = typeof window.XZ?.eyeOf === 'function'
          ? window.XZ.eyeOf(actual || player)
          : null;

        if (eye && eye.every(Number.isFinite)) {
          return { x: eye[0], y: eye[1], z: eye[2] };
        }
      } catch {

      }

      const pos = player?.pos;
      const height = Math.max(0.2, Number(player?.e?.h) || 1.8);

      return {
        x: Number(pos?.[0] ?? pos?.x) || 0,
        y: (Number(pos?.[1] ?? pos?.y) || 0) + height * 0.9,
        z: Number(pos?.[2] ?? pos?.z) || 0
      };
    }

    function validTarget(context, actor, eye) {
      if (!actor || actor.alive === false || !bridge.isEnemy(actor, context.player)) {
        return null;
      }

      const point = aimScratch || (aimScratch = context.player.pos.clone());
      bridge.headPoint(actor, point);

      const dx = point.x - eye.x;
      const dy = point.y - eye.y;
      const dz = point.z - eye.z;
      const distance = Math.hypot(dx, dy, dz);

      if (distance > config.range) {
        return null;
      }

      if (!config.attackThroughWalls && !bridge.worldLineClear(eye, point)) {
        return null;
      }

      return { actor, point: { x: point.x, y: point.y, z: point.z }, distance };
    }

    function selectTarget(context) {
      const eye = playerOrigin(context.player);

      if (config.mode === 'Single' && target) {
        const current = validTarget(context, target, eye);

        if (current) {
          return current;
        }
      }

      let best = null;

      for (const actor of context.actors) {
        const candidate = validTarget(context, actor, eye);

        if (candidate && (!best || candidate.distance < best.distance)) {
          best = candidate;
        }
      }

      return best;
    }

    function targetAngles(eye, point) {
      const dx = point.x - eye.x;
      const dy = point.y - eye.y;
      const dz = point.z - eye.z;

      return {
        yaw: Math.atan2(-dx, -dz),
        pitch: Math.max(-1.5, Math.min(1.5, Math.atan2(dy, Math.hypot(dx, dz))))
      };
    }

    function clearFireAim() {
      aimYaw = null;
      aimPitch = null;

      if (originalGetBlock) {
        try {
          window.game.world.getBlock = originalGetBlock;
        } catch {

        }

        originalGetBlock = null;
      }
    }

    function installProps(player) {
      if (propsPlayer === player || !player || Object.getOwnPropertyDescriptor(player, 'yaw')?.get) {
        return;
      }

      const yawDescriptor = Object.getOwnPropertyDescriptor(player, 'yaw');
      const pitchDescriptor = Object.getOwnPropertyDescriptor(player, 'pitch');

      if ((yawDescriptor && !yawDescriptor.configurable) || (pitchDescriptor && !pitchDescriptor.configurable)) {
        return;
      }

      let actualYaw = Number(player.yaw) || 0;
      let actualPitch = Number(player.pitch) || 0;

      try {
        Object.defineProperty(player, 'yaw', {
          configurable: true,
          enumerable: yawDescriptor?.enumerable ?? true,
          get() {
            return aimYaw === null ? actualYaw : aimYaw;
          },
          set(value) {
            actualYaw = Number(value) || 0;
          }
        });

        Object.defineProperty(player, 'pitch', {
          configurable: true,
          enumerable: pitchDescriptor?.enumerable ?? true,
          get() {
            return aimPitch === null ? actualPitch : aimPitch;
          },
          set(value) {
            actualPitch = Number(value) || 0;
          }
        });

        propsPlayer = player;
      } catch {

      }
    }

    function beginFireAim() {
      if (multiVolley || !renderAim || !aimPoint) {
        return;
      }

      if (config.attackThroughWalls && !originalGetBlock && window.game?.world?.getBlock) {
        originalGetBlock = window.game.world.getBlock;

        try {
          window.game.world.getBlock = function auraGetBlock() {
            return 0;
          };
        } catch {
          originalGetBlock = null;
        }
      }

      aimYaw = renderAim.yaw;
      aimPitch = renderAim.pitch;
      const stamp = ++aimStamp;

      queueMicrotask(() => {
        if (stamp === aimStamp) {
          clearFireAim();
        }
      });
    }

    function installTriggerHook(game) {
      if (triggerHookInstalled || !game || typeof game.handleInteraction !== 'function') {
        return;
      }

      triggerHookInstalled = true;
      const originalInteraction = game.handleInteraction;

      game.handleInteraction = function auraInteraction(...args) {
        const result = originalInteraction.apply(this, args);
        const xz = window.XZ;

        if (
          enabled &&
          target &&
          aimPoint &&
          renderAim &&
          this.player &&
          typeof xz?.trigger === 'function'
        ) {
          try {
            xz.trigger(this, true);

            const player = this.player;
            const gun = typeof xz.gun === 'function'
              ? xz.gun(player?.inv?.held)
              : null;
            const state = typeof xz.state === 'function'
              ? xz.state(player)
              : null;

            if (!multiVolley && gun && !gun.auto && state) {
              state.edge = true;
            }
          } catch {

          }
        }

        return result;
      };
    }

    function installFireHooks(xz) {
      if (fireHooksInstalled || !xz) {
        return;
      }

      fireHooksInstalled = true;

      if (typeof xz.fireSoundOf === 'function' && !xz.fireSoundOf.__solsticeAuraFireSound) {
        const originalFireSoundOf = xz.fireSoundOf;
        const wrappedFireSoundOf = function auraFireSoundOf(stack) {
          if (
            !multiVolley &&
            enabled &&
            target &&
            aimPoint &&
            renderAim &&
            window.game?.state === 'play' &&
            stack === window.game?.player?.inv?.held
          ) {
            beginFireAim();
          }

          return originalFireSoundOf.apply(this, arguments);
        };

        Object.defineProperty(wrappedFireSoundOf, '__solsticeAuraFireSound', { value: true });
        xz.fireSoundOf = wrappedFireSoundOf;
      }

      if (typeof xz.spreadNow === 'function' && !xz.spreadNow.__solsticeAuraSpread) {
        const originalSpread = xz.spreadNow;
        const wrappedSpread = function auraSpread(...args) {
          if (enabled && target && aimPoint && aimYaw !== null) {
            const key = args[1];
            const gun = key && typeof xz.gun === 'function' ? xz.gun(key) : null;

            if (gun && Number(gun.pellets) > 1) {
              const eye = playerOrigin(window.game?.player);
              const distance = Math.hypot(
                aimPoint.x - eye.x,
                aimPoint.y - eye.y,
                aimPoint.z - eye.z
              );
              const angle = Math.atan2(0.12, Math.max(1, distance)) * 180 / Math.PI;

              return Math.max(0.05, Math.min(0.8, angle * 0.8));
            }

            return 0;
          }

          return originalSpread.apply(this, args);
        };

        Object.defineProperty(wrappedSpread, '__solsticeAuraSpread', { value: true });
        xz.spreadNow = wrappedSpread;
      }

      const originalFired = xz.onFired;
      const wrappedFired = function auraFired(game, player, ...args) {
        try {
          return originalFired?.apply(this, arguments);
        } finally {
          if (player !== game?.player) {
            return;
          }

          clearFireAim();
          setFireHeld(false);

          const state = typeof xz.state === 'function' ? xz.state(player) : null;
          const gun = typeof xz.gun === 'function' ? xz.gun(player.inv?.held) : null;

          if (!multiVolley && enabled && target && gun && !gun.auto && state) {
            state.edge = true;
          }

          if (multiVolley) {
            if (state) {
              state.next = 1e9;
              state.edge = false;
            }

            return;
          }

          if (config.mode !== 'Multi' || !enabled || !target) {
            return;
          }

          const context = bridge.getContext();

          if (!context) {
            return;
          }

          const eye = playerOrigin(context.player);
          const fired = target;
          const seen = new Set([fired]);
          const candidates = [];

          for (const actor of context.actors) {
            if (seen.has(actor)) {
              continue;
            }

            const candidate = validTarget(context, actor, eye);

            if (candidate) {
              seen.add(actor);
              candidates.push(candidate);
            }
          }

          candidates.sort((left, right) => left.distance - right.distance);

          multiVolley = true;

          try {
            for (const candidate of candidates) {
              if (gun && typeof xz.rounds === 'function' && xz.rounds(player.inv.held) <= 0) {
                break;
              }

              const angles = targetAngles(eye, candidate.point);
              aimYaw = angles.yaw;
              aimPitch = angles.pitch;

              if (state) {
                state.next = 0;
              }

              const wasAuto = gun ? gun.auto : false;
              let autoChanged = false;

              try {
                if (gun) {
                  gun.auto = false;
                  autoChanged = true;
                }

                xz.trigger(game, true);
                xz.playerTick(game);
              } finally {
                if (autoChanged) {
                  gun.auto = wasAuto;
                }

                xz.trigger(game, false);
              }
            }

            if (state) {
              state.next = 1e9;
              state.edge = false;
            }

            const rate = Math.max(0.01, Number(gun?.rate) || 1);

            queueMicrotask(() => {
              const nextState = typeof xz.state === 'function' ? xz.state(player) : null;

              if (nextState) {
                nextState.next = (Number(game?.tickCount) || 0) + 20 / rate;
                nextState.edge = false;
              }
            });
          } finally {
            multiVolley = false;
            clearFireAim();
            setFireHeld(false);
          }
        }
      };

      Object.defineProperty(wrappedFired, '__solsticeAuraFired', { value: true });
      xz.onFired = wrappedFired;
    }

    function installRenderHook(game) {
      if (renderHookInstalled || !game || typeof game.drawMob !== 'function') {
        return;
      }

      renderHookInstalled = true;
      const originalDrawMob = game.drawMob;

      game.drawMob = function drawMobAura(entity, ...args) {
        if (entity !== this.player || !renderAim) {
          return originalDrawMob.call(this, entity, ...args);
        }

        const yaw = this.player.yaw;
        const pitch = this.player.pitch;

        this.player.yaw = renderAim.yaw;
        this.player.pitch = renderAim.pitch;

        try {
          return originalDrawMob.call(this, entity, ...args);
        } finally {
          this.player.yaw = yaw;
          this.player.pitch = pitch;
        }
      };
    }

    function setFireHeld(wanted) {
      const xz = window.XZ;

      if (!xz || typeof xz.trigger !== 'function') {
        return;
      }

      try {
        xz.trigger(window.game, wanted);
      } catch {

      }
    }

    function setAuraMouseHeld(wanted) {
      const game = window.game;

      if (!game || !Array.isArray(game.mouseBtn)) {
        return;
      }

      if (!wanted) {
        if (auraMouseForced) {
          if (auraMouseGame?.mouseBtn) {
            auraMouseGame.mouseBtn[0] = auraMouseSaved;
          }

          auraMouseForced = false;
          auraMouseGame = null;
        }

        return;
      }

      if (auraMouseForced && auraMouseGame === game) {
        game.mouseBtn[0] = true;
        return;
      }

      if (auraMouseForced && auraMouseGame?.mouseBtn) {
        auraMouseGame.mouseBtn[0] = auraMouseSaved;
      }

      auraMouseGame = game;
      auraMouseSaved = Boolean(game.mouseBtn[0]);
      auraMouseForced = true;
      game.mouseBtn[0] = true;
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'aura') {
        return;
      }

      const range = Number(data.range);
      const mode = ['Single', 'Multi', 'Switch'].includes(data.mode) ? data.mode : 'Switch';

      if (config.mode !== mode && mode !== 'Single') {
        singleTarget = null;
      }

      config = {
        mode,
        range: Number.isFinite(range) ? bridge.clamp(range, 0, bridge.game === 'potatoepic' ? 1000 : 120) : 20,
        attackThroughWalls: data.attackThroughWalls !== false
      };
      enabled = Boolean(data.enabled);

      if (!enabled) {
        target = null;
        singleTarget = null;
        renderAim = null;
        aimPoint = null;
        window.SolsticeAuraTarget = null;
        setAuraMouseHeld(false);
        clearFireAim();
        setFireHeld(false);
      }
    });

    bridge.onBeforePlayerUpdate(() => {
      if (!enabled) {
        target = null;
        singleTarget = null;
        renderAim = null;
        aimPoint = null;
        window.SolsticeAuraTarget = null;
        setAuraMouseHeld(false);
        setFireHeld(false);
        return;
      }

      const context = bridge.getContext();

      if (!context) {
        target = null;
        singleTarget = null;
        renderAim = null;
        aimPoint = null;
        window.SolsticeAuraTarget = null;
        setAuraMouseHeld(false);
        setFireHeld(false);
        return;
      }

      const eye = playerOrigin(context.player);
      const selected = selectTarget(context);

      if (!selected) {
        target = null;
        renderAim = null;
        aimPoint = null;
        window.SolsticeAuraTarget = null;
        setAuraMouseHeld(false);
        setFireHeld(false);

        if (config.mode === 'Single') {
          singleTarget = null;
        }

        return;
      }

      target = selected.actor;
      aimPoint = selected.point;
      window.SolsticeAuraTarget = selected.actor;
      window.SolsticeAuraTargetAt = performance.now();

      if (config.mode === 'Single') {
        singleTarget = target;
      }

      const angles = targetAngles(eye, selected.point);
      renderAim = {
        yaw: angles.yaw,
        pitch: angles.pitch,
        at: performance.now()
      };
      installRenderHook(window.game);
      installProps(window.game?.player);
      installTriggerHook(window.game);
      installFireHooks(window.XZ);
      setAuraMouseHeld(true);
    });
  }
})();
