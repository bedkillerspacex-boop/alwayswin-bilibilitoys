(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-misc';
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

  function setting(module, name, fallback) {
    const value = module.settings.find((entry) => entry.n === name);
    return value ? value.v : fallback;
  }

  function syncConfig() {
    const module = getMod('AntiSnipe');

    if (!module) {
      return;
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'antisnipe',
      enabled: Boolean(module.on),
      range: Math.max(10, Math.min(180, Number(setting(module, 'Range', 120)) || 120)),
      wallCheck: Boolean(setting(module, 'Wall Check', true)),
      jump: Boolean(setting(module, 'Jump', true)),
      crouch: Boolean(setting(module, 'Crouch', true))
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
    name: 'AntiSnipe',
    desc: 'Automatically evades when an enemy holding a sniper aims at you.',
    cat: 'Misc',
    nm: { l: 'antisnipe', ls: 'anti snipe', n: 'AntiSnipe', ns: 'Anti Snipe' },
    disp: '',
    settings: [
      { t: 'n', n: 'Range', d: 'Maximum sniper aim detection distance in meters.', v: 120, min: 10, max: 180, step: 5 },
      { t: 'b', n: 'Wall Check', d: 'Only evade sniper rays with clear line of sight.', v: 1 },
      { t: 'b', n: 'Jump', d: 'Use jumps while evading sniper aim.', v: 1 },
      { t: 'b', n: 'Crouch', d: 'Use crouches while evading sniper aim.', v: 1 }
    ],
    onRender: syncConfig,
    onEnable() {
      syncConfig();
    }
  });

  setInterval(syncConfig, 250);

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
      range: 120,
      wallCheck: true,
      jump: true,
      crouch: true
    };

    let enabled = false;
    let moveKey = null;
    let crouchKey = null;
    let jumpPulse = 0;
    let actionUntil = 0;
    let nextAction = 0;
    let actionIndex = 0;
    let dodgeState = {
      active: false,
      forward: 0,
      right: 0,
      jump: false,
      crouch: false
    };
    const ownedKeys = new Set();

    function inputState() {
      return bridge.getGH()?.debug?.input;
    }

    function addKey(code) {
      const target = inputState();

      if (!target?.keys || target.keys.has(code)) {
        return false;
      }

      target.keys.add(code);
      ownedKeys.add(code);
      return true;
    }

    function addDown(code) {
      const target = inputState();

      if (!target?.keys || !target?.down) {
        return false;
      }

      const hadKey = target.keys.has(code);

      if (!hadKey) {
        target.keys.add(code);
        target.down.add(code);
        ownedKeys.add(code);
        return true;
      }

      return false;
    }

    function release() {
      const target = inputState();

      for (const code of ownedKeys) {
        target?.keys?.delete(code);
        target?.down?.delete(code);
      }

      ownedKeys.clear();
      moveKey = null;
      crouchKey = null;
      jumpPulse = 0;
      dodgeState = {
        active: false,
        forward: 0,
        right: 0,
        jump: false,
        crouch: false
      };
    }

    function enemyBody(actor) {
      return actor.actor || actor;
    }

    function isEnemySniper(actor, snapPlayer) {
      const body = enemyBody(actor);
      const weaponId = actor.char?.weaponId || body.char?.weaponId || actor.def?.id || body.def?.id || actor.weapon || snapPlayer?.weapon;
      return weaponId === 'm200';
    }

    function sniperThreat(context) {
      const { player, actors } = context;
      const height = Number(player.e?.h) > 0.2 ? Number(player.e.h) : 1.8;
      const minX = player.pos.x - 0.55;
      const maxX = player.pos.x + 0.55;
      const minZ = player.pos.z - 0.55;
      const maxZ = player.pos.z + 0.55;
      const minY = player.pos.y + 0.05;
      const maxY = player.pos.y + height + 0.1;

      const snap = bridge.getRawSnapshot?.();
      const snapById = new Map();
      if (Array.isArray(snap?.players)) {
        for (const p of snap.players) {
          if (p && p.id != null) {
            snapById.set(String(p.id), p);
          }
        }
      }

      for (const actor of actors) {
        if (!bridge.isEnemy(actor, player)) {
          continue;
        }

        const snapPlayer = actor.id != null ? snapById.get(String(actor.id)) : null;
        if (!isEnemySniper(actor, snapPlayer)) {
          continue;
        }

        const body = enemyBody(actor);
        const enemyHeight = Number(body.e?.h) > 0.2 ? Number(body.e.h) : 1.8;
        const yaw = Number(actor.aimYaw ?? body.yaw ?? actor.yaw);
        let pitch = Number(actor.aimPitch ?? body.pitch ?? actor.pitch);

        if (!Number.isFinite(yaw)) {
          continue;
        }

        const eye = actor.eye || body.eye || {
          x: actor.pos.x,
          y: actor.pos.y + enemyHeight * 0.9,
          z: actor.pos.z
        };

        if (!Number.isFinite(pitch)) {
          const ex = player.pos.x - eye.x;
          const ez = player.pos.z - eye.z;
          const horizontal = Math.hypot(ex, ez);
          const cone = Math.min(0.45, Math.max(0.1, Math.atan2(0.7, horizontal || 1)));
          const desiredYaw = Math.atan2(-ex, -ez);

          if (Math.abs(bridge.wrapAngle(yaw - desiredYaw)) > cone) {
            continue;
          }

          pitch = Math.atan2(player.pos.y + height * 0.55 - eye.y, horizontal || 1);
        }

        const cos = Math.cos(pitch);
        const dx = -Math.sin(yaw) * cos;
        const dy = Math.sin(pitch);
        const dz = -Math.cos(yaw) * cos;
        const hit = bridge.rayAabb(
          eye.x, eye.y, eye.z,
          dx, dy, dz,
          minX, minY, minZ,
          maxX, maxY, maxZ,
          config.range
        );

        if (hit === null || hit > config.range) {
          continue;
        }

        const point = {
          x: eye.x + dx * hit,
          y: eye.y + dy * hit,
          z: eye.z + dz * hit
        };

        if (config.wallCheck && !bridge.worldLineClear(eye, point)) {
          continue;
        }

        return { actor, eye, point };
      }

      return null;
    }

    function chooseAction(threat) {
      const now = performance.now();
      actionIndex++;
      actionUntil = now + 180 + Math.random() * 80;
      nextAction = actionUntil + 120 + Math.random() * 140;

      const ex = threat.point.x - threat.eye.x;
      const ez = threat.point.z - threat.eye.z;
      const px = threat.point.x - (bridge.getGH()?.debug?.player?.pos.x || 0);
      const pz = threat.point.z - (bridge.getGH()?.debug?.player?.pos.z || 0);
      const side = ex * pz - ez * px;

      if ((actionIndex + (side > 0 ? 1 : 0)) % 2 === 0) {
        moveKey = 'KeyA';
      } else {
        moveKey = 'KeyD';
      }

      if (actionIndex % 4 === 0) {
        moveKey = side > 0 ? 'KeyS' : 'KeyW';
      }

      if (config.crouch && actionIndex % 3 === 0) {
        crouchKey = 'KeyC';
      }

      if (config.jump && actionIndex % 2 === 0) {
        if (addDown('Space')) {
          jumpPulse = now + 60;
        }
      }
    }

    function apply(threat) {
      if (!threat) {
        release();
        return;
      }

      const now = performance.now();

      if (!moveKey || now >= nextAction) {
        release();
        chooseAction(threat);
      }

      if (moveKey) {
        addKey(moveKey);
      }

      if (crouchKey) {
        addKey(crouchKey);
      }

      if (jumpPulse && now < jumpPulse) {
        addDown('Space');
      } else if (jumpPulse) {
        jumpPulse = 0;
        const target = inputState();

        if (ownedKeys.has('Space')) {
          target?.keys?.delete('Space');
          target?.down?.delete('Space');
          ownedKeys.delete('Space');
        }
      }

      dodgeState = {
        active: true,
        forward: moveKey === 'KeyW' ? 1 : moveKey === 'KeyS' ? -1 : 0,
        right: moveKey === 'KeyD' ? 1 : moveKey === 'KeyA' ? -1 : 0,
        jump: Boolean(jumpPulse && now < jumpPulse),
        crouch: Boolean(crouchKey)
      };
    }

    bridge.onConfig('solstice-misc', (data) => {
      if (data.type !== 'config' || data.module !== 'antisnipe') {
        return;
      }

      config = {
        range: Math.max(10, Math.min(180, Number(data.range) || 120)),
        wallCheck: data.wallCheck !== false,
        jump: data.jump !== false,
        crouch: data.crouch !== false
      };
      enabled = Boolean(data.enabled);

      if (!enabled) {
        release();
      }
    });

    bridge.onBeforePlayerUpdate(() => {
      if (!enabled) {
        release();
        return;
      }

      const context = bridge.getContext();

      if (!context || !context.player?.alive) {
        release();
        return;
      }

      apply(sniperThreat(context));
    }, 26);

    bridge.onWorldMove((context) => {
      if (!enabled || !dodgeState.active || !context?.input) {
        return;
      }

      const input = context.input;
      let buttons = Number(input.buttons) || 0;
      buttons &= ~1;
      buttons &= ~4;

      if (dodgeState.jump) {
        buttons |= 1;
      }

      if (dodgeState.crouch) {
        buttons |= 4;
      }

      input.forward = dodgeState.forward;
      input.right = dodgeState.right;
      input.buttons = buttons | 16;
      context.localInput = input;
    }, 88);

    bridge.onReset(release);
  }
})();
