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
    const module = getMod('Fly');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const modeSetting = module.settings.find((entry) => entry.n === 'Mode');
    const frame = findGameFrame();

    if (!frame?.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage({
      channel: CHANNEL,
      type: 'config',
      module: 'fly',
      enabled: Boolean(module.on),
      mode: modeSetting?.vals?.[modeSetting.v] || 'Motion',
      applyGlideFlags: Boolean(setting(module, 'Apply Glide Flags', 1)),
      speed: Number(setting(module, 'Speed', 5.6)),
      speedFriction: Boolean(setting(module, 'Speed Friction', 1)),
      friction: Number(setting(module, 'Friction', 0.975)),
      heightLoss: Number(setting(module, 'Height Loss', 0.5)),
      jumpDelay: Number(setting(module, 'Jump Delay', 0.2)),
      damageOnly: Boolean(setting(module, 'Damage Only', 0)),
      flyTime: Number(setting(module, 'Fly Time', 1)),
      resetOnGround: Boolean(setting(module, 'Reset On Ground', 1)),
      resetOnDisable: Boolean(setting(module, 'Reset On Disable', 1)),
      debug: Boolean(setting(module, 'Debug', 0)),
      step: Number(setting(module, 'Step', 2.5)),
      blinkPulse: Number(setting(module, 'Blink Pulse', 250))
    }, GAME_ORIGIN);
    lastSentAt = now;
  }

  register({
    game: 'potatoepic',
    name: 'Fly',
    desc: 'Allows you to fly.',
    cat: 'Movement',
    nm: { l: 'fly', ls: 'fly', n: 'Fly', ns: 'Fly' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'The mode of the fly.', v: 0, vals: ['Motion', 'Elytra', 'Pregame', 'Jump', 'Vertical', 'Blink'] },
      { t: 'b', n: 'Apply Glide Flags', d: 'Always sends the glide packet while flying.', v: 1 },
      { t: 'n', n: 'Speed', d: 'The speed of the fly.', v: 5.6, min: 0, max: 20, step: 0.1 },
      { t: 'b', n: 'Speed Friction', d: 'Applies friction to speed.', v: 1 },
      { t: 'n', n: 'Friction', d: 'The amount of friction to apply.', v: 0.975, min: 0, max: 1, step: 0.01 },
      { t: 'n', n: 'Height Loss', d: 'The amount of height to lose per airjump.', v: 0.5, min: 0, max: 2, step: 0.01 },
      { t: 'n', n: 'Jump Delay', d: 'The amount of time to wait before jumping (in seconds).', v: 0.2, min: 0, max: 1, step: 0.01 },
      { t: 'b', n: 'Damage Only', d: 'Only fly when you take damage.', v: 0 },
      { t: 'n', n: 'Fly Time', d: 'The amount of time to fly after taking damage (in seconds).', v: 1, min: 0, max: 10, step: 0.01 },
      { t: 'b', n: 'Reset On Ground', d: 'Reset the airjump height when on ground.', v: 1 },
      { t: 'b', n: 'Reset On Disable', d: 'Resets velocity when you disable.', v: 1 },
      { t: 'b', n: 'Debug', d: 'Displays debug messages.', v: 0 },
      { t: 'n', n: 'Step', d: 'The step of the vertical fly.', v: 2.5, min: 1, max: 5, step: 0.01 },
      { t: 'n', n: 'Blink Pulse', d: 'Interval in ms to flush queued movement packets in Blink mode.', v: 250, min: 50, max: 2000, step: 10 }
    ],
    onRender: syncConfig,
    onEnable() {
      lastSentAt = 0;
      syncConfig();
    }
  });

  setInterval(syncConfig, 250);

  document.addEventListener('solstice:module-toggle', (event) => {
    if (event.detail?.name !== 'Fly') {
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
      mode: 'Motion',
      applyGlideFlags: true,
      speed: 5.6,
      speedFriction: true,
      friction: 0.975,
      heightLoss: 0.5,
      jumpDelay: 0.2,
      damageOnly: false,
      flyTime: 1,
      resetOnGround: true,
      resetOnDisable: true,
      debug: false,
      step: 2.5,
      blinkPulse: 250
    };
    let currentY = 0;
    let lastJump = 0;
    let currentFriction = 1;
    let lastHurtTime = 0;
    let damageUntil = 0;
    let verticalTop = null;
    let verticalDone = false;
    let hookedPlayer = null;
    const blinkQueue = [];
    let lastBlinkFlushAt = 0;
    let wsBlinkHooked = false;
    let rtcBlinkHooked = false;

    function isMovementPacket(data) {
      if (typeof data === 'string') {
        return data.includes('"t":"s"') || data.includes('"t":"move"') || data.includes('"t":"pos"') || data.includes('"t":"glide"');
      }
      if (data && typeof data === 'object' && !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer)) {
        return data.t === 's' || data.t === 'move' || data.t === 'pos' || data.t === 'glide';
      }
      return false;
    }

    function flushBlinkQueue() {
      if (!blinkQueue.length) {
        lastBlinkFlushAt = performance.now();
        return;
      }
      const items = blinkQueue.splice(0, blinkQueue.length);
      lastBlinkFlushAt = performance.now();
      for (const item of items) {
        try {
          if (item.target && typeof item.target.readyState === 'number' && item.target.readyState !== 1) {
            continue;
          }
          if (item.target && typeof item.target.readyState === 'string' && item.target.readyState !== 'open') {
            continue;
          }
          item.fn.call(item.target, item.data);
        } catch {}
      }
    }

    function installBlinkHooks() {
      if (!wsBlinkHooked && typeof WebSocket === 'function') {
        wsBlinkHooked = true;
        const origSend = WebSocket.prototype.send;
        const wrapped = function flyBlinkWsSend(data) {
          if (enabled && config.mode === 'Blink' && isMovementPacket(data)) {
            blinkQueue.push({ target: this, fn: origSend, data });
            if (blinkQueue.length >= 120) flushBlinkQueue();
            return;
          }
          return origSend.call(this, data);
        };
        Object.defineProperty(wrapped, '__solsticeFlyBlink', { value: true });
        WebSocket.prototype.send = wrapped;
      }

      if (!rtcBlinkHooked && typeof RTCDataChannel === 'function') {
        rtcBlinkHooked = true;
        const origRtcSend = RTCDataChannel.prototype.send;
        const wrappedRtc = function flyBlinkRtcSend(data) {
          if (enabled && config.mode === 'Blink' && isMovementPacket(data)) {
            blinkQueue.push({ target: this, fn: origRtcSend, data });
            if (blinkQueue.length >= 120) flushBlinkQueue();
            return;
          }
          return origRtcSend.call(this, data);
        };
        Object.defineProperty(wrappedRtc, '__solsticeFlyBlink', { value: true });
        RTCDataChannel.prototype.send = wrappedRtc;
      }
    }

    function debug(message) {
      if (config.debug) {
        console.log('[Fly]', message);
      }
    }

    function sneakDown(game, player) {
      return Boolean(
        game.keys?.ShiftLeft ||
        game.keys?.ShiftRight ||
        player?.sneaking
      );
    }

    function motion(game, yaw, fwd, strafe, speed) {
      const length = Math.hypot(fwd, strafe);

      if (length < 1e-5) {
        return [0, 0];
      }

      const forward = fwd / length;
      const side = strafe / length;
      return [
        (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed,
        (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * speed
      ];
    }

    function topY(player) {
      const world = game?.world;

      if (!world?.getBlock) {
        return player.pos[1] + 50;
      }

      const blocks = typeof BLOCKS !== 'undefined' ? BLOCKS : window.BLOCKS;
      const x = Math.floor(player.pos[0]);
      const z = Math.floor(player.pos[2]);
      let top = null;

      for (let i = 0; i < 50; i++) {
        const y = Math.floor(player.pos[1]) + i;
        const block = blocks?.[world.getBlock(x, y, z)];

        if (block?.solid) {
          top = y + 1;
        }
      }

      return top ?? player.pos[1] + 50;
    }

    function updateHurt(player) {
      if (player.hurtTime > lastHurtTime) {
        damageUntil = performance.now() + Math.max(0, config.flyTime) * 1000;
      }

      lastHurtTime = player.hurtTime;
    }

    function jump(player) {
      const wasGround = player.onGround;
      player.onGround = true;
      player.vel[1] = Math.max(Number(player.vel[1]) || 0, 0.42);
      player.onGround = wasGround;

      const direction = motion(game, player.yaw, 1, 0, 0);
      const speed = config.speed / 10;
      player.vel[0] = direction[0] * speed;
      player.vel[2] = direction[1] * speed;
      currentFriction = 1;
    }

    function installTravelHook(game) {
      const player = game?.player;

      if (!player || typeof player.travel !== 'function' || player.__solsticeFlyTravelHooked) {
        return;
      }

      player.__solsticeFlyTravelHooked = true;

      hookedPlayer = player;
      const originalTravel = player.travel;

      const wrappedTravel = function flyTravel(fwd, strafe, speed, jumpInput) {
        if (!enabled || this !== game.player) {
          return originalTravel.apply(this, arguments);
        }

        const now = performance.now();
        updateHurt(this);
        sendGlide(game);

        if (config.mode === 'Vertical') {
          if (!verticalTop) {
            verticalTop = topY(this);
          }

          if (verticalDone || this.pos[1] >= verticalTop) {
            verticalDone = true;
            return;
          }

          this.move(0, config.step, 0);
          this.onGround = false;
          return;
        }

        if (config.mode === 'Jump') {
          const damageActive = !config.damageOnly || now < damageUntil;

          if (!damageActive) {
            return originalTravel.apply(this, arguments);
          }

          if (this.onGround) {
            currentFriction = 1;
            currentY = this.pos[1];
          } else if (config.speedFriction) {
            currentFriction *= config.friction;
            const direction = motion(game, this.yaw, Number(fwd) || 0, Number(strafe) || 0, (config.speed * currentFriction) / 10);
            this.vel[0] = direction[0];
            this.vel[2] = direction[1];
          }

          if (!this.onGround && this.pos[1] < currentY && now - lastJump > config.jumpDelay * 1000) {
            jump(this);
            lastJump = now;
            currentY -= config.heightLoss;
          }

          if (this.onGround && config.resetOnGround) {
            currentY = this.pos[1];
          }

          return originalTravel.apply(this, arguments);
        }

        const fallbackSpeed = config.mode === 'Pregame' ? 0.255 : config.speed / 10;
        const direction = motion(game, this.yaw, Number(fwd) || 0, Number(strafe) || 0, fallbackSpeed);
        let vx = direction[0];
        let vz = direction[1];
        let vy = config.mode === 'Pregame' ? -0.0005 : 0;

        if (jumpInput) {
          vy += fallbackSpeed;
        } else if (sneakDown(game, this)) {
          vy -= fallbackSpeed;
        }

        if (config.mode === 'Elytra') {
          this.gliding = true;
        }

        this.vel[0] = vx;
        this.vel[1] = vy;
        this.vel[2] = vz;
        this.move(vx, vy, vz);
        this.fallDist = 0;
      };

      Object.defineProperty(wrappedTravel, '__solsticeFlyTravel', { value: true });
      player.travel = wrappedTravel;
    }

    function sendGlide(game) {
      if (!game?.net?.send) {
        return;
      }

      if (config.mode !== 'Elytra' && !config.applyGlideFlags) {
        return;
      }

      game.net.send({ t: 'glide' });
    }

    function resetFlight(player) {
      if (!player) {
        return;
      }

      player.gliding = false;

      if (config.resetOnDisable) {
        player.vel[0] = 0;
        player.vel[2] = 0;
      }
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'fly') {
        return;
      }

      const wasEnabled = enabled;
      enabled = Boolean(data.enabled);
      config = {
        mode: ['Motion', 'Elytra', 'Pregame', 'Jump', 'Vertical', 'Blink'].includes(data.mode) ? data.mode : 'Motion',
        applyGlideFlags: data.applyGlideFlags !== false,
        speed: Math.max(0, Math.min(20, Number(data.speed) || 0)),
        speedFriction: data.speedFriction !== false,
        friction: Math.max(0, Math.min(1, Number(data.friction) || 0)),
        heightLoss: Math.max(0, Math.min(2, Number(data.heightLoss) || 0)),
        jumpDelay: Math.max(0, Math.min(1, Number(data.jumpDelay) || 0)),
        damageOnly: data.damageOnly === true,
        flyTime: Math.max(0, Math.min(10, Number(data.flyTime) || 0)),
        resetOnGround: data.resetOnGround !== false,
        resetOnDisable: data.resetOnDisable !== false,
        debug: data.debug === true,
        step: Math.max(1, Math.min(5, Number(data.step) || 1)),
        blinkPulse: Math.max(50, Math.min(2000, Number(data.blinkPulse) || 250))
      };

      const player = window.game?.player;

      if (enabled && !wasEnabled && player) {
        currentY = player.pos[1];
        currentFriction = 1;
        lastJump = performance.now();
        lastBlinkFlushAt = performance.now();
        lastHurtTime = player.hurtTime || 0;
        damageUntil = 0;
        verticalTop = config.mode === 'Vertical' ? topY(player) : null;
        verticalDone = false;
        sendGlide(window.game);
        debug(`enabled ${config.mode}`);
      }

      if (!enabled && wasEnabled) {
        flushBlinkQueue();
        resetFlight(player);
        debug('disabled');
      } else if (enabled && config.mode !== 'Blink' && blinkQueue.length) {
        flushBlinkQueue();
      }

      installBlinkHooks();
      installTravelHook(window.game);
    });

    installBlinkHooks();
    installTravelHook(window.game);
    setInterval(() => {
      installBlinkHooks();
      installTravelHook(window.game);
      if (enabled && config.mode === 'Blink' && blinkQueue.length && performance.now() - lastBlinkFlushAt >= config.blinkPulse) {
        flushBlinkQueue();
      }
    }, 30);
  }
})();
