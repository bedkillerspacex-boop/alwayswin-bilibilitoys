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
    const module = getMod('Backtrack');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const maxWindowMs = Math.max(50, Math.min(350, Number(setting(module, 'Max Window (ms)', 250)) || 250));
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'backtrack',
      enabled: Boolean(module.on),
      maxWindowMs,
      onlyAura: Boolean(setting(module, 'Only Aura', false)),
      wallCheck: Boolean(setting(module, 'Wall Check', true)),
      showGhost: Boolean(setting(module, 'Show Ghost', true))
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
    name: 'Backtrack',
    desc: 'Rewinds shot/melee tick to recent snapshots where targets were exposed.',
    cat: 'Combat',
    nm: { l: 'backtrack', ls: 'backtrack', n: 'Backtrack', ns: 'Backtrack' },
    disp: 'Max Window (ms)',
    settings: [
      { t: 'n', n: 'Max Window (ms)', d: 'Maximum snapshot rewind window in milliseconds.', v: 250, min: 50, max: 350, step: 10 },
      { t: 'b', n: 'Only Aura', d: 'Only activate Backtrack when Aura is locked onto a target.', v: 0 },
      { t: 'b', n: 'Wall Check', d: 'Verify line of sight in world geometry before backtracking.', v: 1 },
      { t: 'b', n: 'Show Ghost', d: 'Draw cyan backtrack ghost box and diamond marker at enemy server/backtrack position.', v: 1 }
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
    let maxWindowMs = 250;
    let onlyAura = false;
    let wallCheck = true;
    let showGhost = true;

    let overlayCanvas = null;
    let overlayCtx = null;
    let overlayWidth = 0;
    let overlayHeight = 0;
    let overlayDpr = 1;
    let hadContent = false;
    let lastDrawAt = 0;
    let renderHookInstalled = false;

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

    function findExposedShot(actor, origin, world, range, pickPointFn) {
      if (!enabled || actor?.id == null || typeof bridge.getEngineSnapshots !== 'function') {
        return null;
      }

      const snapshots = bridge.getEngineSnapshots();

      if (!Array.isArray(snapshots) || snapshots.length < 2) {
        return null;
      }

      const latestSnap = snapshots[snapshots.length - 1];
      const latestTime = Number(latestSnap?.time) || 0;

      for (let i = snapshots.length - 2; i >= 0; i -= 1) {
        const snap = snapshots[i];

        if (!snap || !Array.isArray(snap.players) || !Number.isFinite(snap.tick)) {
          continue;
        }

        const ageMs = latestTime > 0 && Number.isFinite(snap.time)
          ? latestTime - snap.time
          : (snapshots.length - 1 - i) * 33;

        if (ageMs > maxWindowMs) {
          break;
        }

        const raw = snap.players.find((p) => p && p.id === actor.id);

        if (!raw || raw.alive === false) {
          continue;
        }

        const height = raw.sliding ? 0.95 : raw.crouch ? 1.2 : 1.8;
        const base = { x: raw.x, y: raw.y, z: raw.z, height };
        const pt = typeof pickPointFn === 'function'
          ? pickPointFn(base)
          : { x: base.x, y: base.y + height - 0.17, z: base.z };

        if (!pt || !isClear(world, origin, pt)) {
          continue;
        }

        const dist = Math.hypot(pt.x - origin.x, pt.y - origin.y, pt.z - origin.z);

        if (dist <= range) {
          return {
            point: pt,
            tick: snap.tick,
            backtrackMs: Math.max(0, Math.round(ageMs)),
            distance: dist
          };
        }
      }

      return null;
    }

    function tryStandaloneBacktrack(actor, eye, dir, maxRange) {
      if (!enabled || onlyAura || !bridge.active || bridge.uiOpen) {
        return null;
      }

      const debug = bridge.getGH()?.debug;

      if (!debug?.player || actor !== debug.player || !debug.player.alive || !dir) {
        return null;
      }

      // If Aura already locked a target and handled the shot, do not override it
      const aura = typeof bridge.getFeature === 'function' ? bridge.getFeature('aura') : null;

      if (aura && typeof aura.getTarget === 'function' && aura.getTarget()) {
        return null;
      }

      const snapshots = typeof bridge.getEngineSnapshots === 'function' ? bridge.getEngineSnapshots() : null;

      if (!Array.isArray(snapshots) || snapshots.length < 2) {
        return null;
      }

      const engineState = typeof bridge.getEngineState === 'function' ? bridge.getEngineState() : null;
      const world = engineState?.world || null;
      const origin = eye || debug.player.eye || debug.gfx?.camera?.position;

      if (!origin) {
        return null;
      }

      const len = Math.hypot(dir.x, dir.y, dir.z);

      if (len < 1e-4) {
        return null;
      }

      const ndx = dir.x / len;
      const ndy = dir.y / len;
      const ndz = dir.z / len;

      const latestSnap = snapshots[snapshots.length - 1];
      const latestTime = Number(latestSnap?.time) || 0;
      const actors = debug.match?.actors || [];
      const enemyIds = new Set();

      for (const a of actors) {
        if (bridge.isEnemy(a, debug.player) && a.id != null) {
          enemyIds.add(a.id);
        }
      }

      if (enemyIds.size === 0) {
        return null;
      }

      for (let i = snapshots.length - 1; i >= 0; i -= 1) {
        const snap = snapshots[i];

        if (!snap || !Array.isArray(snap.players) || !Number.isFinite(snap.tick)) {
          continue;
        }

        const ageMs = latestTime > 0 && Number.isFinite(snap.time)
          ? latestTime - snap.time
          : (snapshots.length - 1 - i) * 33;

        if (ageMs > maxWindowMs) {
          break;
        }

        for (const raw of snap.players) {
          if (!raw || raw.alive === false || !enemyIds.has(raw.id)) {
            continue;
          }

          const height = raw.sliding ? 0.95 : raw.crouch ? 1.2 : 1.8;
          const hitDist = bridge.rayAabb(
            origin.x,
            origin.y,
            origin.z,
            ndx,
            ndy,
            ndz,
            raw.x - 0.32,
            raw.y + 0.15,
            raw.z - 0.32,
            raw.x + 0.32,
            raw.y + height,
            raw.z + 0.32,
            maxRange
          );

          if (hitDist === null) {
            continue;
          }

          const hitPt = {
            x: origin.x + ndx * hitDist,
            y: origin.y + ndy * hitDist,
            z: origin.z + ndz * hitDist
          };

          if (isClear(world, origin, hitPt)) {
            if (typeof bridge.setShotTickOverride === 'function') {
              bridge.setShotTickOverride(snap.tick, 120);
            }
            return null;
          }
        }
      }

      return null;
    }

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
      overlayCanvas.id = 'solstice-backtrack-overlay';
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
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);

      if (overlayCanvas.width !== pixelWidth || overlayCanvas.height !== pixelHeight) {
        overlayCanvas.width = pixelWidth;
        overlayCanvas.height = pixelHeight;
      }

      overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      overlayWidth = width;
      overlayHeight = height;
      overlayDpr = dpr;
    }

    function clearOverlay() {
      if (!overlayCtx || !hadContent) {
        return;
      }

      overlayCtx.clearRect(0, 0, overlayWidth, overlayHeight);
      hadContent = false;
    }

    function projectPt(camera, point, forward, wx, wy, wz) {
      point.set(wx, wy, wz);
      const dx = point.x - camera.position.x;
      const dy = point.y - camera.position.y;
      const dz = point.z - camera.position.z;

      if (dx * forward.x + dy * forward.y + dz * forward.z <= 0.1) {
        return null;
      }

      point.project(camera);

      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.z < -1 || point.z > 1) {
        return null;
      }

      return [
        (point.x * 0.5 + 0.5) * overlayWidth,
        (-point.y * 0.5 + 0.5) * overlayHeight
      ];
    }

    function drawGhost() {
      if (!enabled || !showGhost || !bridge.active || bridge.uiOpen) {
        clearOverlay();
        return;
      }

      const minInterval = Number(bridge.overlayMinIntervalMs) || 0;

      if (minInterval > 0) {
        const now = performance.now();
        if (now - lastDrawAt < minInterval - 1) {
          return;
        }
        lastDrawAt = now;
      }

      if (!ensureOverlay()) {
        return;
      }

      const dprCap = Number(bridge.maxDpr) > 0 ? Number(bridge.maxDpr) : 2;

      if (
        window.innerWidth !== overlayWidth ||
        window.innerHeight !== overlayHeight ||
        Math.min(window.devicePixelRatio || 1, dprCap) !== overlayDpr
      ) {
        resizeOverlay();
      }

      clearOverlay();

      const gh = bridge.getGH();

      if (!gh?.ready || gh.G?.state !== 'playing') {
        return;
      }

      const debug = gh.debug;
      const camera = debug?.gfx?.camera;
      const player = debug?.player;
      const actors = debug?.match?.actors;
      const snapshots = typeof bridge.getEngineSnapshots === 'function' ? bridge.getEngineSnapshots() : null;

      if (!camera || !player?.pos || !Array.isArray(actors) || !Array.isArray(snapshots) || snapshots.length === 0) {
        return;
      }

      const latestSnap = snapshots[snapshots.length - 1];
      const latestTime = Number(latestSnap?.time) || 0;
      const point = player.pos.clone();
      const forward = player.pos.clone();
      camera.getWorldDirection(forward);

      const aura = typeof bridge.getFeature === 'function' ? bridge.getFeature('aura') : null;
      const auraTarget = aura && typeof aura.getTarget === 'function' ? aura.getTarget() : null;

      overlayCtx.lineWidth = 1.5;

      for (const actor of actors) {
        if (!bridge.isEnemy(actor, player) || actor.id == null) {
          continue;
        }

        if (onlyAura && actor !== auraTarget) {
          continue;
        }

        // Find oldest valid snapshot within maxWindowMs to visualize full backtrack trail/ghost
        let ghostRaw = null;
        let ghostAge = 0;

        for (let i = snapshots.length - 1; i >= 0; i -= 1) {
          const snap = snapshots[i];

          if (!snap || !Array.isArray(snap.players)) {
            continue;
          }

          const ageMs = latestTime > 0 && Number.isFinite(snap.time)
            ? latestTime - snap.time
            : (snapshots.length - 1 - i) * 33;

          if (ageMs > maxWindowMs) {
            break;
          }

          const found = snap.players.find((p) => p && p.id === actor.id && p.alive !== false);

          if (found) {
            ghostRaw = found;
            ghostAge = Math.round(ageMs);
          }
        }

        if (!ghostRaw) {
          continue;
        }

        const height = ghostRaw.sliding ? 0.95 : ghostRaw.crouch ? 1.2 : 1.8;
        const hw = 0.30;
        const corners = [
          [ghostRaw.x - hw, ghostRaw.y + 0.05, ghostRaw.z - hw],
          [ghostRaw.x + hw, ghostRaw.y + 0.05, ghostRaw.z - hw],
          [ghostRaw.x + hw, ghostRaw.y + 0.05, ghostRaw.z + hw],
          [ghostRaw.x - hw, ghostRaw.y + 0.05, ghostRaw.z + hw],
          [ghostRaw.x - hw, ghostRaw.y + height, ghostRaw.z - hw],
          [ghostRaw.x + hw, ghostRaw.y + height, ghostRaw.z - hw],
          [ghostRaw.x + hw, ghostRaw.y + height, ghostRaw.z + hw],
          [ghostRaw.x - hw, ghostRaw.y + height, ghostRaw.z + hw]
        ];
        const pts = [];
        let ok = true;

        for (const c of corners) {
          const p2 = projectPt(camera, point, forward, c[0], c[1], c[2]);
          if (!p2) {
            ok = false;
            break;
          }
          pts.push(p2);
        }

        if (!ok) {
          continue;
        }

        // Cyan dashed wireframe box for backtracked position
        overlayCtx.save();
        overlayCtx.strokeStyle = 'rgba(0, 245, 255, 0.85)';
        overlayCtx.fillStyle = 'rgba(0, 245, 255, 0.14)';
        overlayCtx.setLineDash([4, 3]);
        const edges = [
          [0, 1], [1, 2], [2, 3], [3, 0],
          [4, 5], [5, 6], [6, 7], [7, 4],
          [0, 4], [1, 5], [2, 6], [3, 7]
        ];
        overlayCtx.beginPath();
        for (const [a, b] of edges) {
          overlayCtx.moveTo(pts[a][0], pts[a][1]);
          overlayCtx.lineTo(pts[b][0], pts[b][1]);
        }
        overlayCtx.stroke();

        // Trail line from rendered actor position to ghost position
        const curPt = projectPt(camera, point, forward, actor.pos.x, actor.pos.y + height * 0.5, actor.pos.z);
        const ghostCenter = projectPt(camera, point, forward, ghostRaw.x, ghostRaw.y + height * 0.5, ghostRaw.z);

        if (curPt && ghostCenter) {
          overlayCtx.strokeStyle = 'rgba(0, 245, 255, 0.55)';
          overlayCtx.beginPath();
          overlayCtx.moveTo(curPt[0], curPt[1]);
          overlayCtx.lineTo(ghostCenter[0], ghostCenter[1]);
          overlayCtx.stroke();
        }

        // Bright cyan diamond marker at ghost head
        const headPt = projectPt(camera, point, forward, ghostRaw.x, ghostRaw.y + height - 0.17, ghostRaw.z);

        if (headPt) {
          overlayCtx.setLineDash([]);
          overlayCtx.fillStyle = 'rgba(0, 245, 255, 0.92)';
          overlayCtx.beginPath();
          overlayCtx.moveTo(headPt[0], headPt[1] - 5);
          overlayCtx.lineTo(headPt[0] + 5, headPt[1]);
          overlayCtx.lineTo(headPt[0], headPt[1] + 5);
          overlayCtx.lineTo(headPt[0] - 5, headPt[1]);
          overlayCtx.closePath();
          overlayCtx.fill();

          if (ghostAge > 0) {
            overlayCtx.font = '600 10px system-ui, -apple-system, sans-serif';
            overlayCtx.textAlign = 'center';
            overlayCtx.fillText(`BT -${ghostAge}ms`, headPt[0], headPt[1] - 9);
          }
        }

        overlayCtx.restore();
        hadContent = true;
      }
    }

    function installRenderHook() {
      const gfx = bridge.getGH()?.debug?.gfx;

      if (!gfx || typeof gfx.render !== 'function' || gfx.render.__solsticeBacktrackWrapped) {
        return;
      }

      const originalRender = gfx.render;
      const wrappedRender = function wrappedBacktrackRender(...args) {
        const result = originalRender.apply(this, args);

        try {
          drawGhost();
        } catch {

        }

        return result;
      };

      Object.defineProperty(wrappedRender, '__solsticeBacktrackWrapped', { value: true });
      gfx.render = wrappedRender;
      renderHookInstalled = true;
    }

    bridge.onCombatFire((actor, eye, dir) => tryStandaloneBacktrack(actor, eye, dir, 140), 25);
    bridge.onCombatMelee((actor, eye, dir) => tryStandaloneBacktrack(actor, eye, dir, 4.5), 25);

    bridge.provide('backtrack', {
      isEnabled: () => enabled && !onlyAura,
      isActiveForAura: () => enabled,
      findExposedShot
    });

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'backtrack') {
        return;
      }

      enabled = Boolean(data.enabled);
      maxWindowMs = Math.max(50, Math.min(350, Number(data.maxWindowMs) || 250));
      onlyAura = Boolean(data.onlyAura);
      wallCheck = data.wallCheck !== false;
      showGhost = data.showGhost !== false;

      if (!enabled || !showGhost) {
        clearOverlay();
      }
    });

    bridge.onReset(clearOverlay);
    window.addEventListener('resize', resizeOverlay);
    installRenderHook();
    setInterval(installRenderHook, 500);
  }
})();
