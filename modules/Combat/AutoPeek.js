(() => {
  'use strict';

  const CHANNEL = 'solstice-autopeek';
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
    const entry = module.settings.find((s) => s.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig() {
    const module = getMod('AutoPeek');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const modeSetting = module.settings.find((s) => s.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] === 'Fight' ? 'Fight' : 'Jiggle';
    const retractDelaySetting = module.settings.find((s) => s.n === 'Retract Delay');

    if (retractDelaySetting) {
      retractDelaySetting.vis = mode === 'Jiggle';
    }

    const config = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(module.on),
      mode,
      peekRange: Math.max(1.0, Math.min(4.0, Number(setting(module, 'Peek Range', 2.5)) || 2.5)),
      retractDelay: Math.max(0, Math.min(400, Number(setting(module, 'Retract Delay', 80)) || 0)),
      maxEnemyDist: Math.max(5, Math.min(60, Number(setting(module, 'Max Enemy Dist', 35)) || 35)),
      sprintPeek: Boolean(setting(module, 'Sprint Peek', true)),
      drawAnchor: Boolean(setting(module, 'Draw Anchor', true))
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
    name: 'AutoPeek',
    desc: 'Automatically peeks out from cover to fight and retracts back.',
    cat: 'Combat',
    nm: { l: 'autopeek', ls: 'auto peek', n: 'AutoPeek', ns: 'Auto Peek' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'Jiggle fires and immediately retracts; Fight holds until kill/reload.', v: 0, vals: ['Jiggle', 'Fight'] },
      { t: 'n', n: 'Peek Range', d: 'Max distance in meters to probe around cover.', v: 2.5, min: 1.0, max: 4.0, step: 0.25 },
      { t: 'n', n: 'Retract Delay', d: 'Milliseconds to wait after firing before retracting (Jiggle).', v: 80, min: 0, max: 400, step: 25 },
      { t: 'n', n: 'Max Enemy Dist', d: 'Maximum distance to consider enemies behind cover.', v: 35, min: 5, max: 60, step: 1 },
      { t: 'b', n: 'Sprint Peek', d: 'Use sprint speed while peeking and retracting.', v: 1 },
      { t: 'b', n: 'Draw Anchor', d: 'Draw your cover anchor and peek point.', v: 1 }
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
    const SPRINT_BUTTON = 2;
    const MANUAL_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const heldKeys = new Set();

    let config = {
      enabled: false,
      mode: 'Jiggle',
      peekRange: 2.5,
      retractDelay: 80,
      maxEnemyDist: 35,
      sprintPeek: true,
      drawAnchor: true
    };

    let state = 'idle'; // 'idle' | 'peeking' | 'retracting'
    let anchor = null;
    let peekPoint = null;
    let targetActor = null;
    let stateStartedAt = 0;
    let firedAt = 0;
    let cooldownUntil = 0;
    let steerForward = 0;
    let steerRight = 0;
    let steerActive = false;

    let overlayCanvas = null;
    let overlayCtx = null;
    let overlayW = 0;
    let overlayH = 0;
    let overlayDpr = 1;
    let hadOverlay = false;
    let tempPoint = null;
    let tempForward = null;

    window.addEventListener('keydown', (e) => {
      if (MANUAL_KEYS.has(e.code)) {
        heldKeys.add(e.code);
      }
    }, true);

    window.addEventListener('keyup', (e) => {
      heldKeys.delete(e.code);
    }, true);

    window.addEventListener('blur', () => {
      heldKeys.clear();
    });

    function resetPeek() {
      state = 'idle';
      anchor = null;
      peekPoint = null;
      targetActor = null;
      stateStartedAt = 0;
      firedAt = 0;
      steerActive = false;
      steerForward = 0;
      steerRight = 0;
    }

    function hasManualMove() {
      return heldKeys.size > 0;
    }

    function getHeadPoint(actor) {
      const h = actor?.e?.h || 1.8;
      return {
        x: actor.pos.x,
        y: actor.pos.y + h - 0.17,
        z: actor.pos.z
      };
    }

    function findCoverPeek(context, now) {
      const { player, actors } = context;
      const eyeY = player.pos.y + (player.e?.h ? player.e.h - 0.16 : 1.62);
      const eye = { x: player.pos.x, y: eyeY, z: player.pos.z };
      const irc = typeof bridge.getFeature === 'function' ? bridge.getFeature('irc') : null;
      const maxDistSq = config.maxEnemyDist * config.maxEnemyDist;

      const blockedEnemies = [];

      for (const actor of actors) {
        if (!actor?.pos || actor.alive === false || !bridge.isEnemy(actor, player)) {
          continue;
        }

        if (irc && typeof irc.isProtected === 'function' && irc.isProtected(actor)) {
          continue;
        }

        const dx = actor.pos.x - player.pos.x;
        const dy = actor.pos.y - player.pos.y;
        const dz = actor.pos.z - player.pos.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq > maxDistSq || distSq < 1.0) {
          continue;
        }

        const enemyHead = getHeadPoint(actor);

        if (!bridge.worldLineClear(eye, enemyHead)) {
          blockedEnemies.push({ actor, enemyHead, distSq });
        }
      }

      if (blockedEnemies.length === 0) {
        return null;
      }

      blockedEnemies.sort((a, b) => a.distSq - b.distSq);

      for (const candidate of blockedEnemies) {
        const toX = candidate.enemyHead.x - eye.x;
        const toZ = candidate.enemyHead.z - eye.z;
        const horizLen = Math.hypot(toX, toZ);

        if (horizLen < 0.1) {
          continue;
        }

        const perpX = -toZ / horizLen;
        const perpZ = toX / horizLen;

        for (let dist = 0.6; dist <= config.peekRange + 0.01; dist += 0.5) {
          for (const side of [-1, 1]) {
            const px = player.pos.x + perpX * side * dist;
            const pz = player.pos.z + perpZ * side * dist;
            const probeEye = { x: px, y: eyeY, z: pz };
            const probeFeet = { x: px, y: player.pos.y + 0.45, z: pz };
            const curFeet = { x: player.pos.x, y: player.pos.y + 0.45, z: player.pos.z };

            if (!bridge.worldLineClear(curFeet, probeFeet) || !bridge.worldLineClear(eye, probeEye)) {
              continue;
            }

            if (bridge.worldLineClear(probeEye, candidate.enemyHead)) {
              return {
                actor: candidate.actor,
                point: { x: px, y: player.pos.y, z: pz }
              };
            }
          }
        }
      }

      return null;
    }

    function computeSteer(playerPos, dest, yaw) {
      const dx = dest.x - playerPos.x;
      const dz = dest.z - playerPos.z;
      const dist = Math.hypot(dx, dz);

      if (dist <= 0.22) {
        return { arrived: true, forward: 0, right: 0 };
      }

      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      const nx = dx / dist;
      const nz = dz / dist;

      return {
        arrived: false,
        forward: Math.max(-1, Math.min(1, -sy * nx - cy * nz)),
        right: Math.max(-1, Math.min(1, cy * nx - sy * nz))
      };
    }

    function updatePeek() {
      steerActive = false;
      steerForward = 0;
      steerRight = 0;

      if (!config.enabled) {
        resetPeek();
        return;
      }

      const gh = bridge.getGH();
      const context = bridge.getContext();
      const player = context?.player;

      if (!gh?.ready || gh.G?.state !== 'playing' || !player?.pos || player.alive === false) {
        resetPeek();
        return;
      }

      if (hasManualMove()) {
        state = 'idle';
        anchor = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
        peekPoint = null;
        targetActor = null;
        return;
      }

      const now = performance.now();
      const eyeY = player.pos.y + (player.e?.h ? player.e.h - 0.16 : 1.62);
      const eye = { x: player.pos.x, y: eyeY, z: player.pos.z };
      const yaw = Number(player.yaw) || 0;

      if (state === 'idle') {
        if (!anchor || Math.hypot(player.pos.x - anchor.x, player.pos.z - anchor.z) > 0.6) {
          anchor = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
        }

        if (now < cooldownUntil) {
          return;
        }

        const found = findCoverPeek(context, now);

        if (found) {
          anchor = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
          peekPoint = found.point;
          targetActor = found.actor;
          state = 'peeking';
          stateStartedAt = now;
          firedAt = 0;
        }

        return;
      }

      if (state === 'peeking') {
        const reloading = context?.arsenal?.state === 'reload';
        const targetDead = !targetActor || targetActor.alive === false || !targetActor.pos;
        const timedOut = now - stateStartedAt > 1800;

        if (reloading || targetDead || timedOut) {
          state = 'retracting';
          stateStartedAt = now;
          return;
        }

        const enemyHead = getHeadPoint(targetActor);
        const visible = bridge.worldLineClear(eye, enemyHead);

        if (config.mode === 'Jiggle') {
          if (firedAt > 0 && now - firedAt >= config.retractDelay) {
            state = 'retracting';
            stateStartedAt = now;
            return;
          }

          if (!visible && peekPoint) {
            const steer = computeSteer(player.pos, peekPoint, yaw);

            if (!steer.arrived) {
              steerActive = true;
              steerForward = steer.forward;
              steerRight = steer.right;
            }
          }
        } else {
          if (!visible && peekPoint) {
            const steer = computeSteer(player.pos, peekPoint, yaw);

            if (!steer.arrived) {
              steerActive = true;
              steerForward = steer.forward;
              steerRight = steer.right;
            }
          }
        }

        return;
      }

      if (state === 'retracting') {
        if (!anchor || now - stateStartedAt > 1800) {
          state = 'idle';
          cooldownUntil = now + 260;
          return;
        }

        const steer = computeSteer(player.pos, anchor, yaw);

        if (steer.arrived) {
          state = 'idle';
          cooldownUntil = now + 260;
          return;
        }

        steerActive = true;
        steerForward = steer.forward;
        steerRight = steer.right;
      }
    }

    bridge.onCombatFire((actor) => {
      if (!config.enabled || state !== 'peeking') {
        return null;
      }

      const context = bridge.getContext();

      if (context?.player && actor === context.player && firedAt === 0) {
        firedAt = performance.now();
      }

      return null;
    }, 30);

    bridge.onWorldMove((context) => {
      if (!config.enabled || !steerActive || !context?.input) {
        return;
      }

      const input = context.input;
      input.forward = steerForward;
      input.right = steerRight;

      if (config.sprintPeek) {
        input.buttons = (Number(input.buttons) || 0) | SPRINT_BUTTON;
      }

      context.localInput = input;
    }, 90);

    function ensureOverlay() {
      if (overlayCanvas && overlayCtx) {
        if (!overlayCanvas.isConnected && document.documentElement) {
          document.documentElement.append(overlayCanvas);
        }

        return overlayCanvas.isConnected;
      }

      if (!document.documentElement) {
        return false;
      }

      overlayCanvas = document.createElement('canvas');
      overlayCanvas.id = 'solstice-autopeek-overlay';
      overlayCanvas.setAttribute('aria-hidden', 'true');
      overlayCanvas.style.cssText = [
        'position: fixed',
        'inset: 0',
        'display: block',
        'width: 100vw',
        'height: 100vh',
        'pointer-events: none',
        'z-index: 2147483646'
      ].join(';');

      document.documentElement.append(overlayCanvas);
      overlayCtx = overlayCanvas.getContext('2d');
      resizeOverlay();
      return Boolean(overlayCtx);
    }

    function resizeOverlay() {
      if (!overlayCanvas || !overlayCtx) {
        return;
      }

      const dprCap = Number(bridge.maxDpr) > 0 ? Number(bridge.maxDpr) : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);

      if (overlayCanvas.width !== Math.round(w * dpr) || overlayCanvas.height !== Math.round(h * dpr)) {
        overlayCanvas.width = Math.round(w * dpr);
        overlayCanvas.height = Math.round(h * dpr);
      }

      overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      overlayW = w;
      overlayH = h;
      overlayDpr = dpr;
    }

    function clearOverlay() {
      if (!overlayCtx || !hadOverlay) {
        return;
      }

      overlayCtx.clearRect(0, 0, overlayW, overlayH);
      hadOverlay = false;
    }

    function projectWorld(point, camera, three) {
      if (!tempPoint) {
        tempPoint = new three.Vector3();
      }

      if (!tempForward) {
        tempForward = new three.Vector3();
      }

      camera.getWorldDirection(tempForward);
      const dx = point.x - camera.position.x;
      const dy = point.y - camera.position.y;
      const dz = point.z - camera.position.z;

      if (dx * tempForward.x + dy * tempForward.y + dz * tempForward.z <= 0.1) {
        return null;
      }

      tempPoint.set(point.x, point.y, point.z).project(camera);

      if (!Number.isFinite(tempPoint.x) || !Number.isFinite(tempPoint.y) || tempPoint.z < -1 || tempPoint.z > 1) {
        return null;
      }

      return {
        x: (tempPoint.x * 0.5 + 0.5) * overlayW,
        y: (-tempPoint.y * 0.5 + 0.5) * overlayH
      };
    }

    function drawOverlay() {
      if (!config.enabled || !config.drawAnchor || bridge.uiOpen || !anchor) {
        clearOverlay();
        return;
      }

      const gh = bridge.getGH();

      if (!gh?.ready || gh.G?.state !== 'playing') {
        clearOverlay();
        return;
      }

      const camera = gh.debug?.gfx?.camera;
      const three = gh.three;

      if (!camera || !three?.Vector3 || !ensureOverlay()) {
        clearOverlay();
        return;
      }

      const dprCap = Number(bridge.maxDpr) > 0 ? Number(bridge.maxDpr) : 2;

      if (window.innerWidth !== overlayW || window.innerHeight !== overlayH || Math.min(window.devicePixelRatio || 1, dprCap) !== overlayDpr) {
        resizeOverlay();
      }

      clearOverlay();

      const a2d = projectWorld({ x: anchor.x, y: anchor.y + 0.08, z: anchor.z }, camera, three);

      if (!a2d) {
        return;
      }

      overlayCtx.save();
      overlayCtx.strokeStyle = state === 'peeking' ? '#4ade80' : state === 'retracting' ? '#facc15' : '#38bdf8';
      overlayCtx.fillStyle = 'rgba(15, 23, 42, 0.45)';
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.arc(a2d.x, a2d.y, 10, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.stroke();

      if (peekPoint && state !== 'idle') {
        const p2d = projectWorld({ x: peekPoint.x, y: peekPoint.y + 0.08, z: peekPoint.z }, camera, three);

        if (p2d) {
          overlayCtx.setLineDash([4, 4]);
          overlayCtx.beginPath();
          overlayCtx.moveTo(a2d.x, a2d.y);
          overlayCtx.lineTo(p2d.x, p2d.y);
          overlayCtx.stroke();
          overlayCtx.setLineDash([]);
          overlayCtx.beginPath();
          overlayCtx.arc(p2d.x, p2d.y, 6, 0, Math.PI * 2);
          overlayCtx.stroke();
        }
      }

      overlayCtx.restore();
      hadOverlay = true;
    }

    bridge.onBeforePlayerUpdate(() => {
      updatePeek();
      drawOverlay();
    }, 35);

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }

      config = {
        enabled: Boolean(data.enabled),
        mode: data.mode === 'Fight' ? 'Fight' : 'Jiggle',
        peekRange: Math.max(1.0, Math.min(4.0, Number(data.peekRange) || 2.5)),
        retractDelay: Math.max(0, Math.min(400, Number(data.retractDelay) || 0)),
        maxEnemyDist: Math.max(5, Math.min(60, Number(data.maxEnemyDist) || 35)),
        sprintPeek: data.sprintPeek !== false,
        drawAnchor: data.drawAnchor !== false
      };

      if (!config.enabled) {
        resetPeek();
        clearOverlay();
      }
    });

    bridge.onReset(() => {
      resetPeek();
      clearOverlay();
    });

    window.addEventListener('resize', resizeOverlay);
  }
})();
