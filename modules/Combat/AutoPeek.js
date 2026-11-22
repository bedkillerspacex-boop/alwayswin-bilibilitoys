(() => {
  'use strict';

  const CHANNEL = 'solstice-autopeek';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const OUTER_ORIGIN = 'https://www.bilibili.com';
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
    const rawMode = modeSetting?.vals?.[modeSetting.v];
    const mode = rawMode === 'Fight' ? 'Fight' : rawMode === 'Jiggle' ? 'Jiggle' : 'Smart';
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
      autoDisable: Boolean(setting(module, 'Auto Disable', false)),
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

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN || event.data?.channel !== CHANNEL || event.data.type !== 'disable') {
      return;
    }

    const frame = findGameFrame();

    if (!frame || event.source !== frame.contentWindow) {
      return;
    }

    const module = getMod('AutoPeek');

    if (module?.on) {
      setModuleOn(module, false);
    }
  });

  register({
    name: 'AutoPeek',
    desc: 'Automatically peeks out from cover to fight and retracts back.',
    cat: 'Combat',
    nm: { l: 'autopeek', ls: 'auto peek', n: 'AutoPeek', ns: 'Auto Peek' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'Smart exposes minimum body & avoids enemy crosshair; Jiggle fires once; Fight holds.', v: 0, vals: ['Smart', 'Jiggle', 'Fight'] },
      { t: 'n', n: 'Peek Range', d: 'Max distance in meters to probe around cover.', v: 2.5, min: 1.0, max: 4.0, step: 0.25 },
      { t: 'n', n: 'Retract Delay', d: 'Milliseconds to wait after firing before retracting (Jiggle).', v: 80, min: 0, max: 400, step: 25 },
      { t: 'n', n: 'Max Enemy Dist', d: 'Maximum distance to consider enemies behind cover.', v: 35, min: 5, max: 60, step: 1 },
      { t: 'b', n: 'Sprint Peek', d: 'Use sprint speed while peeking and retracting.', v: 1 },
      { t: 'b', n: 'Auto Disable', d: 'Automatically turn off AutoPeek after one completed peek.', v: 0 },
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
      mode: 'Smart',
      peekRange: 2.5,
      retractDelay: 80,
      maxEnemyDist: 35,
      sprintPeek: true,
      autoDisable: false,
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
        const snap = bridge.getRawSnapshot?.();
        const enemySnap = Array.isArray(snap?.players)
          ? snap.players.find((p) => p && p.id != null && String(p.id) === String(candidate.actor.id))
          : null;
        const enemyYaw = enemySnap && Number.isFinite(enemySnap.yaw) ? enemySnap.yaw : null;

        let bestOption = null;
        const step = config.mode === 'Smart' ? 0.22 : 0.45;
        const startDist = config.mode === 'Smart' ? 0.35 : 0.6;

        for (const side of [-1, 1]) {
          for (let dist = startDist; dist <= config.peekRange + 0.01; dist += step) {
            const px = player.pos.x + perpX * side * dist;
            const pz = player.pos.z + perpZ * side * dist;
            const probeEye = { x: px, y: eyeY, z: pz };
            const probeFeet = { x: px, y: player.pos.y + 0.45, z: pz };
            const curFeet = { x: player.pos.x, y: player.pos.y + 0.45, z: player.pos.z };

            if (!bridge.worldLineClear(curFeet, probeFeet) || !bridge.worldLineClear(eye, probeEye)) {
              break;
            }

            if (bridge.worldLineClear(probeEye, candidate.enemyHead)) {
              let score = dist;
              if (config.mode === 'Smart' && enemyYaw !== null) {
                const ex = px - candidate.enemyHead.x;
                const ez = pz - candidate.enemyHead.z;
                const elen = Math.hypot(ex, ez) || 1;
                const efx = -Math.sin(enemyYaw);
                const efz = -Math.cos(enemyYaw);
                const lookDot = (ex * efx + ez * efz) / elen;
                // Prefer off-angle away from enemy crosshair, while keeping exposure minimal
                score += lookDot * 0.85;
              }

              if (!bestOption || score < bestOption.score) {
                bestOption = {
                  actor: candidate.actor,
                  point: { x: px, y: player.pos.y, z: pz },
                  score
                };
              }
              break;
            }
          }
        }

        if (bestOption) {
          return {
            actor: bestOption.actor,
            point: bestOption.point
          };
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
        steerActive = false;
        steerForward = 0;
        steerRight = 0;
        peekPoint = null;
        targetActor = null;
        anchor = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
        return;
      }

      const now = performance.now();
      const eyeY = player.pos.y + (player.e?.h ? player.e.h - 0.16 : 1.62);
      const eye = { x: player.pos.x, y: eyeY, z: player.pos.z };
      const yaw = Number(player.yaw) || 0;

      if (state === 'idle') {
        if (!anchor || hasManualMove() || Math.hypot(player.pos.x - anchor.x, player.pos.z - anchor.z) > 0.6) {
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
        } else if (config.mode === 'Smart') {
          // Expose minimum body: stop immediately once enemy head is visible, retract if enemy locks onto us after we shoot
          if (!visible && peekPoint) {
            const steer = computeSteer(player.pos, peekPoint, yaw);

            if (!steer.arrived) {
              steerActive = true;
              steerForward = steer.forward;
              steerRight = steer.right;
            }
          } else if (visible && firedAt > 0 && now - firedAt > 260) {
            const snap = bridge.getRawSnapshot?.();
            const enemySnap = Array.isArray(snap?.players)
              ? snap.players.find((p) => p && p.id != null && String(p.id) === String(targetActor.id))
              : null;
            if (enemySnap && Number.isFinite(enemySnap.yaw)) {
              const ex = player.pos.x - targetActor.pos.x;
              const ez = player.pos.z - targetActor.pos.z;
              const elen = Math.hypot(ex, ez) || 1;
              const lookDot = (ex * (-Math.sin(enemySnap.yaw)) + ez * (-Math.cos(enemySnap.yaw))) / elen;
              if (lookDot > 0.92) {
                state = 'retracting';
                stateStartedAt = now;
                return;
              }
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
        const done = !anchor || now - stateStartedAt > 1800 || computeSteer(player.pos, anchor, yaw).arrived;

        if (done) {
          state = 'idle';
          cooldownUntil = now + 260;

          if (config.autoDisable) {
            resetPeek();
            try {
              window.parent.postMessage({ channel: CHANNEL, type: 'disable' }, OUTER_ORIGIN);
            } catch {

            }
          }
          return;
        }

        const steer = computeSteer(player.pos, anchor, yaw);
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
      const manualMag = Math.hypot(Number(input.forward) || 0, Number(input.right) || 0);

      if (manualMag > 0.01 || hasManualMove()) {
        state = 'idle';
        steerActive = false;
        steerForward = 0;
        steerRight = 0;
        peekPoint = null;
        targetActor = null;
        return;
      }

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
        mode: data.mode === 'Fight' ? 'Fight' : data.mode === 'Jiggle' ? 'Jiggle' : 'Smart',
        peekRange: Math.max(1.0, Math.min(4.0, Number(data.peekRange) || 2.5)),
        retractDelay: Math.max(0, Math.min(400, Number(data.retractDelay) || 0)),
        maxEnemyDist: Math.max(5, Math.min(60, Number(data.maxEnemyDist) || 35)),
        sprintPeek: data.sprintPeek !== false,
        autoDisable: Boolean(data.autoDisable),
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
