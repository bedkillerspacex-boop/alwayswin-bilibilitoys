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
    const entry = module?.settings.find((item) => item.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig() {
    const module = getMod('MeleeAura');

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
      module: 'meleeaura',
      enabled: Boolean(module.on),
      range: Math.max(1.5, Math.min(5.0, Number(setting(module, 'Range', 3.2)) || 3.2)),
      cooldownMs: Math.max(250, Math.min(1000, Number(setting(module, 'Cooldown', 450)) || 450)),
      autoSwing: Boolean(setting(module, 'Auto Swing', true)),
      wallCheck: Boolean(setting(module, 'Wall Check', true))
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
    name: 'MeleeAura',
    desc: 'Automatically aims and sends melee attacks to nearby enemies.',
    cat: 'Combat',
    nm: { l: 'meleeaura', ls: 'melee aura', n: 'MeleeAura', ns: 'Melee Aura' },
    disp: 'Range',
    settings: [
      { t: 'n', n: 'Range', d: 'Maximum melee attack range in meters.', v: 3.2, min: 1.5, max: 5.0, step: 0.1 },
      { t: 'n', n: 'Cooldown', d: 'Delay between automatic melee swings (ms).', v: 450, min: 250, max: 1000, step: 25 },
      { t: 'b', n: 'Auto Swing', d: 'Automatically swing melee when an enemy is in range.', v: 1 },
      { t: 'b', n: 'Wall Check', d: 'Require clear line of sight to target.', v: 1 }
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
    let range = 3.2;
    let cooldownMs = 450;
    let autoSwing = true;
    let wallCheck = true;
    let currentTarget = null;
    let lastSwingAt = 0;

    function shooterOrigin(debug, engineState) {
      const predicted = engineState?.predicted;
      const rawSelf = typeof bridge.getRawSelf === 'function' ? bridge.getRawSelf() : null;
      const hasRawSelf = Boolean(rawSelf && rawSelf.alive !== false);

      if (hasRawSelf && predicted) {
        if (Math.hypot(predicted.x - rawSelf.x, predicted.y - rawSelf.y, predicted.z - rawSelf.z) > 0.15) {
          const eyeH = rawSelf.sliding ? 0.72 : rawSelf.crouch ? 1.0 : 1.62;
          return { x: rawSelf.x, y: rawSelf.y + eyeH, z: rawSelf.z };
        }
      }

      if (predicted) {
        const eyeH = predicted.sliding ? 0.72 : predicted.crouch ? 1.0 : 1.62;
        return { x: predicted.x, y: predicted.y + eyeH, z: predicted.z };
      }

      if (debug?.player?.pos) {
        const p = debug.player;
        const eyeH = p.mode === 'slide' ? 0.72 : p.stance === 'crouch' ? 1.0 : 1.62;
        return { x: p.pos.x, y: p.pos.y + eyeH, z: p.pos.z };
      }

      return debug?.gfx?.camera?.position || null;
    }

    function isClear(world, origin, pt) {
      if (!wallCheck) {
        return true;
      }

      const dx = pt.x - origin.x;
      const dy = pt.y - origin.y;
      const dz = pt.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist <= 0.15) {
        return true;
      }

      if (world && typeof world.raycast === 'function') {
        const hit = world.raycast(origin, { x: dx / dist, y: dy / dist, z: dz / dist }, dist);
        return !hit || hit.distance <= 0.05 || hit.distance >= dist - 0.08;
      }

      return bridge.worldLineClear(origin, pt);
    }

    function pickNearestMeleeTarget(context, origin, world) {
      const { player, actors } = context;
      const irc = typeof bridge.getFeature === 'function' ? bridge.getFeature('irc') : null;
      const bt = typeof bridge.getFeature === 'function' ? bridge.getFeature('backtrack') : null;
      let best = null;

      for (const actor of actors) {
        if (!bridge.isEnemy(actor, player)) {
          continue;
        }

        if (irc && typeof irc.isProtected === 'function' && irc.isProtected(actor)) {
          continue;
        }

        const raw = typeof bridge.getRawPlayer === 'function' ? bridge.getRawPlayer(actor) : null;
        let pt = null;
        let tick = null;

        if (raw && raw.alive !== false) {
          const h = raw.sliding ? 0.95 : raw.crouch ? 1.2 : 1.8;
          pt = { x: raw.x, y: raw.y + h * 0.65, z: raw.z };
        } else if (actor.pos) {
          const h = Number(actor.e?.h) > 0.2 ? Number(actor.e.h) : 1.8;
          pt = { x: actor.pos.x, y: actor.pos.y + h * 0.65, z: actor.pos.z };
        }

        if (pt) {
          const dist = Math.hypot(pt.x - origin.x, pt.y - origin.y, pt.z - origin.z);

          if (dist <= range && isClear(world, origin, pt)) {
            if (!best || dist < best.distance) {
              best = { actor, point: pt, distance: dist, tick: null };
            }
            continue;
          }
        }

        if (bt && typeof bt.findExposedShot === 'function' && bt.isEnabled?.()) {
          const shot = bt.findExposedShot(actor, origin, world, range, (base) => ({
            x: base.x,
            y: base.y + base.height * 0.65,
            z: base.z
          }));

          if (shot && (!best || shot.distance < best.distance)) {
            best = { actor, point: shot.point, distance: shot.distance, tick: shot.tick };
          }
        }
      }

      return best;
    }

    bridge.onBeforePlayerUpdate(() => {
      if (!enabled || !bridge.active || bridge.uiOpen) {
        currentTarget = null;
        return;
      }

      const context = bridge.getContext();

      if (!context || !context.player?.alive) {
        currentTarget = null;
        return;
      }

      const engineState = typeof bridge.getEngineState === 'function' ? bridge.getEngineState() : null;
      const origin = shooterOrigin(context.debug, engineState);

      if (!origin) {
        currentTarget = null;
        return;
      }

      const picked = pickNearestMeleeTarget(context, origin, engineState?.world || null);

      if (!picked) {
        currentTarget = null;
        return;
      }

      currentTarget = picked.actor;

      if (!autoSwing) {
        return;
      }

      const now = performance.now();

      if (now - lastSwingAt < cooldownMs) {
        return;
      }

      const meleeFn = context.debug?.ctx?.combat?.melee;

      if (typeof meleeFn !== 'function') {
        return;
      }

      const dx = picked.point.x - origin.x;
      const dy = picked.point.y - origin.y;
      const dz = picked.point.z - origin.z;
      const len = Math.hypot(dx, dy, dz);

      if (len < 1e-4) {
        return;
      }

      if (picked.tick && typeof bridge.setShotTickOverride === 'function') {
        bridge.setShotTickOverride(picked.tick, 120);
      }

      lastSwingAt = now;
      meleeFn(context.player, context.player.eye || origin, {
        x: dx / len,
        y: dy / len,
        z: dz / len
      });
    }, 35);

    bridge.onCombatMelee((actor, eye) => {
      if (!enabled || !bridge.active || bridge.uiOpen) {
        return null;
      }

      const context = bridge.getContext();

      if (!context || actor !== context.player || !context.player.alive) {
        return null;
      }

      const engineState = typeof bridge.getEngineState === 'function' ? bridge.getEngineState() : null;
      const origin = eye || shooterOrigin(context.debug, engineState);

      if (!origin) {
        return null;
      }

      const picked = pickNearestMeleeTarget(context, origin, engineState?.world || null);

      if (!picked) {
        return null;
      }

      if (picked.tick && typeof bridge.setShotTickOverride === 'function') {
        bridge.setShotTickOverride(picked.tick, 120);
      }

      const dx = picked.point.x - origin.x;
      const dy = picked.point.y - origin.y;
      const dz = picked.point.z - origin.z;
      const len = Math.hypot(dx, dy, dz);

      if (len < 1e-4) {
        return null;
      }

      return { x: dx / len, y: dy / len, z: dz / len };
    }, 10);

    bridge.provide('meleeaura', {
      isReady: () => Boolean(enabled && currentTarget)
    });

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'meleeaura') {
        return;
      }

      enabled = Boolean(data.enabled);
      range = Math.max(1.5, Math.min(5.0, Number(data.range) || 3.2));
      cooldownMs = Math.max(250, Math.min(1000, Number(data.cooldownMs) || 450));
      autoSwing = data.autoSwing !== false;
      wallCheck = data.wallCheck !== false;

      if (!enabled) {
        currentTarget = null;
      }
    });

    bridge.onReset(() => {
      currentTarget = null;
    });
  }
})();
