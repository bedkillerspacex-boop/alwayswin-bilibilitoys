(() => {
  'use strict';

  const CHANNEL = 'solstice-movement';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/potatoepic/')) {
    bootGame();
    return;
  }

  let lastSentAt = 0;

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}/toy/potatoepic/`)) {
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
    const module = getMod('Speed');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const jumpSetting = module.settings.find((entry) => entry.n === 'Jump Type');
    const fastFallSetting = module.settings.find((entry) => entry.n === 'Fast Fall');
    const frame = findGameFrame();

    if (!frame?.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage({
      channel: CHANNEL,
      type: 'config',
      module: 'speed',
      enabled: Boolean(module.on),
      mode: setting(module, 'Mode', 0) === 1 ? 'Legit' : 'Friction',
      damageBoost: Boolean(setting(module, 'Damage Boost', 0)),
      damageBoostSpeed: Number(setting(module, 'Damage Boost Speed', 3)),
      damageBoostSlowdown: Number(setting(module, 'Damage Boost Slowdown', 0.15)),
      ignoreStrafe: Boolean(setting(module, 'Ignore Strafe', 1)),
      speed: Number(setting(module, 'Speed', 0.5)),
      randomizeSpeed: Boolean(setting(module, 'Randomize Speed', 0)),
      minSpeed: Number(setting(module, 'Min Speed', 0.5)),
      maxSpeed: Number(setting(module, 'Max Speed', 1)),
      strafeOnly: Boolean(setting(module, 'Strafe Only', 1)),
      useStrafeSpeed: Boolean(setting(module, 'Custom Strafe Speed', 1)),
      strafeSpeed: Number(setting(module, 'Strafe Speed', 0.5)),
      friction: Number(setting(module, 'Friction', 0.975)),
      fastFall: fastFallSetting?.vals?.[fastFallSetting.v] || 'None',
      fallTicks: Number(setting(module, 'Fall Ticks', 5)),
      fallSpeed: Number(setting(module, 'Fall Speed', 1)),
      fastFall2: Boolean(setting(module, 'Fast Fall 2', 0)),
      fallTicks2: Number(setting(module, 'Fall Ticks 2', 5)),
      fallSpeed2: Number(setting(module, 'Fall Speed 2', 1)),
      jumpType: jumpSetting?.vals?.[jumpSetting.v] || 'Vanilla',
      jumpHeight: Number(setting(module, 'Jump Height', 0.42))
    }, GAME_ORIGIN);
    lastSentAt = now;
  }

  register({
    game: 'potatoepic',
    name: 'Speed',
    desc: 'Lets you move faster.',
    cat: 'Movement',
    nm: { l: 'speed', ls: 'speed', n: 'Speed', ns: 'Speed' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'The mode of speed', v: 0, vals: ['Friction', 'Legit'] },
      { t: 'b', n: 'Damage Boost', d: 'Whether or not to boost speed when taking damage.', v: 0 },
      { t: 'n', n: 'Damage Boost Speed', d: 'The speed to boost when taking damage.', v: 3, min: 1, max: 10, step: 0.01 },
      { t: 'n', n: 'Damage Boost Slowdown', d: 'The friction to apply when taking damage.', v: 0.15, min: 0, max: 1, step: 0.01 },
      { t: 'b', n: 'Ignore Strafe', d: 'Do not increase strafe speed.', v: 1 },
      { t: 'n', n: 'Speed', d: 'The speed to move at.', v: 0.5, min: 0, max: 10, step: 0.01 },
      { t: 'b', n: 'Randomize Speed', d: 'Whether or not to randomize speed.', v: 0 },
      { t: 'n', n: 'Min Speed', d: 'The minimum speed.', v: 0.5, min: 0, max: 10, step: 0.01 },
      { t: 'n', n: 'Max Speed', d: 'The maximum speed.', v: 1, min: 0, max: 10, step: 0.01 },
      { t: 'b', n: 'Strafe Only', d: 'Whether or not to allow strafing.', v: 1 },
      { t: 'b', n: 'Custom Strafe Speed', d: 'Whether or not to apply custom speed when strafing.', v: 1 },
      { t: 'n', n: 'Strafe Speed', d: 'The speed to strafe at.', v: 0.5, min: 0, max: 10, step: 0.01 },
      { t: 'n', n: 'Friction', d: 'The friction to apply.', v: 0.975, min: 0, max: 1, step: 0.01 },
      { t: 'e', n: 'Fast Fall', d: 'The mode of fast fall.', v: 0, vals: ['None', 'Predict', 'Set Vel'] },
      { t: 'n', n: 'Fall Ticks', d: 'The tick to apply down motion at.', v: 5, min: 0, max: 20, step: 1 },
      { t: 'n', n: 'Fall Speed', d: 'The speed to fall down at.', v: 1, min: 0, max: 10, step: 0.01 },
      { t: 'b', n: 'Fast Fall 2', d: 'Whether or not to fast fall again.', v: 0 },
      { t: 'n', n: 'Fall Ticks 2', d: 'The second tick to apply down motion at.', v: 5, min: 0, max: 20, step: 1 },
      { t: 'n', n: 'Fall Speed 2', d: 'The second speed to fall down at.', v: 1, min: 0, max: 10, step: 0.01 },
      { t: 'e', n: 'Jump Type', d: 'The type of jump to use.', v: 0, vals: ['Vanilla', 'Velocity', 'None'] },
      { t: 'n', n: 'Jump Height', d: 'The height to jump at.', v: 0.42, min: 0, max: 1, step: 0.01 }
    ],
    onRender: syncConfig,
    onEnable() {
      lastSentAt = 0;
      syncConfig();
    }
  });

  setInterval(syncConfig, 250);

  document.addEventListener('solstice:module-toggle', (event) => {
    if (event.detail?.name !== 'Speed') {
      return;
    }

    lastSentAt = 0;
    syncConfig();
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
    let config = {
      mode: 'Friction',
      damageBoost: false,
      damageBoostSpeed: 3,
      damageBoostSlowdown: 0.15,
      ignoreStrafe: true,
      speed: 0.5,
      randomizeSpeed: false,
      minSpeed: 0.5,
      maxSpeed: 1,
      strafeOnly: true,
      useStrafeSpeed: true,
      strafeSpeed: 0.5,
      friction: 0.975,
      fastFall: 'None',
      fallTicks: 5,
      fallSpeed: 1,
      fastFall2: false,
      fallTicks2: 5,
      fallSpeed2: 1,
      jumpType: 'Vanilla',
      jumpHeight: 0.42
    };
    let airFactor = 1;
    let airTicks = 0;
    let damageBoost = 1;
    let lastHurtTime = 0;

    function pressed(game, name) {
      return Boolean(game.keys?.[name]);
    }

    function movement(game, input) {
      const inputFwd = Number(input?.fwd) || 0;
      const inputStrafe = Number(input?.strafe) || 0;
      const keyFwd = (pressed(game, 'KeyW') || pressed(game, 'ArrowUp') ? 1 : 0) -
        (pressed(game, 'KeyS') || pressed(game, 'ArrowDown') ? 1 : 0);
      const keyStrafe = (pressed(game, 'KeyD') || pressed(game, 'ArrowRight') ? 1 : 0) -
        (pressed(game, 'KeyA') || pressed(game, 'ArrowLeft') ? 1 : 0);

      return {
        fwd: Math.abs(inputFwd) > 0.01 ? inputFwd : keyFwd,
        strafe: Math.abs(inputStrafe) > 0.01 ? inputStrafe : keyStrafe,
        jump: Boolean(input?.jump) || pressed(game, 'Space')
      };
    }

    function speedForMove(move, player) {
      let speed = config.randomizeSpeed
        ? config.minSpeed + Math.random() * Math.max(0, config.maxSpeed - config.minSpeed)
        : config.speed;
      const strafingOnly = move.fwd === 0 && move.strafe !== 0;

      if (strafingOnly && config.useStrafeSpeed) {
        speed = config.strafeSpeed;
      }

      let boost = 1;

      if (config.damageBoost) {
        if (player.hurtTime > lastHurtTime) {
          damageBoost = config.damageBoostSpeed;
        }

        lastHurtTime = player.hurtTime;
        boost = damageBoost;
        damageBoost += (1 - damageBoost) * config.damageBoostSlowdown;
      }

      if (config.ignoreStrafe && strafingOnly) {
        boost = 1;
      }

      return speed * boost;
    }

    function applyFastFall(player) {
      if (player.onGround) {
        airTicks = 0;
        return;
      }

      airTicks++;

      if (config.fastFall === 'Predict') {
        if (airTicks === config.fallTicks) {
          for (let i = 0; i < config.fallSpeed; i++) {
            player.vel[1] = (player.vel[1] - 0.08) * 0.98;
          }
        }

        if (config.fastFall2 && airTicks === config.fallTicks2) {
          for (let i = 0; i < config.fallSpeed2; i++) {
            player.vel[1] = (player.vel[1] - 0.08) * 0.98;
          }
        }
      } else if (config.fastFall === 'Set Vel') {
        if (airTicks === config.fallTicks) {
          player.vel[1] = -config.fallSpeed / 10;
        }

        if (config.fastFall2 && airTicks === config.fallTicks2) {
          player.vel[1] = -config.fallSpeed2 / 10;
        }
      }
    }

    function installTravelHook(game) {
      const player = game?.player;

      if (!player || typeof player.travel !== 'function' || player.__solsticeSpeedTravelHooked) {
        return;
      }

      player.__solsticeSpeedTravelHooked = true;

      const originalTravel = player.travel;
      const wrappedTravel = function speedTravel(fwd, strafe, speed, jump) {
        if (!enabled || this !== game.player) {
          return originalTravel.apply(this, arguments);
        }

        const move = movement(game, { fwd, strafe, jump });
        const moving = move.fwd !== 0 || move.strafe !== 0;

        if (!config.strafeOnly) {
          move.strafe = 0;
        }

        if (this.onGround) {
          airFactor = 1;
        } else {
          airFactor *= config.friction;
        }

        const ownSpeed = moving ? speedForMove(move, this) : 0;
        const horizontal = ownSpeed * (this.onGround ? 1 : airFactor);
        let dx = 0;
        let dz = 0;

        if (moving) {
          const length = Math.hypot(move.fwd, move.strafe) || 1;
          const yaw = Number(this.yaw) || 0;
          const sin = Math.sin(yaw);
          const cos = Math.cos(yaw);
          dx = (-sin * move.fwd + cos * move.strafe) / length;
          dz = (-cos * move.fwd - sin * move.strafe) / length;
          this.vel[0] = dx * horizontal;
          this.vel[2] = dz * horizontal;
          this.potV = [dx * horizontal, dz * horizontal];
        }

        if (this.onGround && moving && config.jumpType !== 'None') {
          this.vel[1] = config.jumpHeight;
        }

        const result = originalTravel.apply(this, arguments);

        if (moving) {
          this.vel[0] = dx * horizontal;
          this.vel[2] = dz * horizontal;
          this.potV = [dx * horizontal, dz * horizontal];
        }

        applyFastFall(this);
        return result;
      };

      Object.defineProperty(wrappedTravel, '__solsticeSpeedTravel', { value: true });
      player.travel = wrappedTravel;
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'speed') {
        return;
      }

      enabled = Boolean(data.enabled);
      config = {
        mode: data.mode === 'Legit' ? 'Legit' : 'Friction',
        damageBoost: data.damageBoost === true,
        damageBoostSpeed: Math.max(1, Math.min(10, Number(data.damageBoostSpeed) || 1)),
        damageBoostSlowdown: Math.max(0, Math.min(1, Number(data.damageBoostSlowdown) || 0)),
        ignoreStrafe: data.ignoreStrafe !== false,
        speed: Math.max(0, Math.min(10, Number(data.speed) || 0)),
        randomizeSpeed: data.randomizeSpeed === true,
        minSpeed: Math.max(0, Math.min(10, Number(data.minSpeed) || 0)),
        maxSpeed: Math.max(0, Math.min(10, Number(data.maxSpeed) || 0)),
        strafeOnly: data.strafeOnly !== false,
        useStrafeSpeed: data.useStrafeSpeed !== false,
        strafeSpeed: Math.max(0, Math.min(10, Number(data.strafeSpeed) || 0)),
        friction: Math.max(0, Math.min(1, Number(data.friction) || 0)),
        fastFall: ['Predict', 'Set Vel'].includes(data.fastFall) ? data.fastFall : 'None',
        fallTicks: Math.max(0, Math.min(20, Number(data.fallTicks) || 0)),
        fallSpeed: Math.max(0, Math.min(10, Number(data.fallSpeed) || 0)),
        fastFall2: data.fastFall2 === true,
        fallTicks2: Math.max(0, Math.min(20, Number(data.fallTicks2) || 0)),
        fallSpeed2: Math.max(0, Math.min(10, Number(data.fallSpeed2) || 0)),
        jumpType: ['None', 'Velocity'].includes(data.jumpType) ? data.jumpType : 'Vanilla',
        jumpHeight: Math.max(0, Math.min(1, Number(data.jumpHeight) || 0))
      };
      airFactor = 1;
      airTicks = 0;
      damageBoost = 1;
      lastHurtTime = 0;
      installTravelHook(window.game);
    });

    installTravelHook(window.game);
    setInterval(() => installTravelHook(window.game), 500);
  }
})();
