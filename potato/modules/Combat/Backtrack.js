(() => {
  'use strict';

  const CHANNEL = 'solstice-combat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 100;
  const HEARTBEAT_MS = 500;

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/potatoepic/')) {
    bootGame();
    return;
  }

  let lastSentKey = '';
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
    const entry = module?.settings.find((item) => item.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig(force = false) {
    const module = getMod('Backtrack');
    if (!module) return;

    const now = performance.now();
    if (!force && now - lastSentAt < MIN_SEND_INTERVAL_MS) return;

    const maxWindowMs = Math.max(50, Math.min(450, Number(setting(module, 'Max Window', 250)) || 250));
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

    if (!force && key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) return;

    const frame = findGameFrame();
    if (!frame?.contentWindow) return;

    frame.contentWindow.postMessage(config, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    game: 'potatoepic',
    name: 'Backtrack',
    desc: 'Rewinds enemy hitboxes to recent exposed snapshots on shot and draws backtrack ghosts.',
    cat: 'Combat',
    nm: { l: 'backtrack', ls: 'backtrack', n: 'Backtrack', ns: 'Backtrack' },
    disp: 'Max Window',
    settings: [
      { t: 'n', n: 'Max Window', d: 'Maximum snapshot rewind window in milliseconds.', v: 250, min: 50, max: 450, step: 10 },
      { t: 'b', n: 'Only Aura', d: 'Only activate Backtrack when Aura is locked onto a target.', v: 0 },
      { t: 'b', n: 'Wall Check', d: 'Verify line of sight in world geometry before backtracking.', v: 1 },
      { t: 'b', n: 'Show Ghost', d: 'Draw cyan backtrack ghost box and diamond marker at enemy backtrack position.', v: 1 }
    ],
    onRender: () => syncConfig(false),
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncConfig(true);
    }
  });

  function bootGame() {
    let attempts = 0;
    function start() {
      const bridge = window.SolsticeGame;
      if (!bridge) {
        if (attempts++ < 120) setTimeout(start, 25);
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

    const history = new Map(); // entity -> [{ ts, x, y, z, h }]
    const activeBacktracks = new Map(); // entity -> best snapshot

    let overlayCanvas = null;
    let overlayCtx = null;
    let overlayW = 0;
    let overlayH = 0;
    let overlayDpr = 1;
    let hadContent = false;

    function isAuraFresh() {
      return Boolean(window.SolsticeAuraTarget && performance.now() - (Number(window.SolsticeAuraTargetAt) || 0) < 600);
    }

    function ensureOverlay() {
      if (!overlayCanvas) {
        overlayCanvas = document.createElement('canvas');
        overlayCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483642;';
        document.documentElement.appendChild(overlayCanvas);
        overlayCtx = overlayCanvas.getContext('2d');
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dprCap = Number(bridge.maxDpr) > 0 ? Number(bridge.maxDpr) : 1.5;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      if (w !== overlayW || h !== overlayH || dpr !== overlayDpr) {
        overlayW = w;
        overlayH = h;
        overlayDpr = dpr;
        overlayCanvas.width = Math.round(w * dpr);
        overlayCanvas.height = Math.round(h * dpr);
        overlayCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    function clearOverlay() {
      if (overlayCtx && hadContent) {
        overlayCtx.clearRect(0, 0, overlayW, overlayH);
        hadContent = false;
      }
    }

    function recordAndSelect() {
      activeBacktracks.clear();
      if (!enabled || window.game?.state !== 'play' || window.game?.ui?.screen) {
        clearOverlay();
        return;
      }
      if (onlyAura && !isAuraFresh()) {
        clearOverlay();
        return;
      }

      const ctxInfo = bridge.getContext();
      if (!ctxInfo) {
        clearOverlay();
        return;
      }

      const { player, camera, actors } = ctxInfo;
      const eye = bridge.getEye ? bridge.getEye() : camera.position;
      const cp = Math.cos(player.pitch);
      const fwdX = -Math.sin(player.yaw) * cp;
      const fwdY = Math.sin(player.pitch);
      const fwdZ = -Math.cos(player.yaw) * cp;

      const now = performance.now();
      const cutoff = now - maxWindowMs;
      const aliveEntities = new Set();

      for (const actor of actors) {
        if (!bridge.isEnemy(actor, player) || !actor._entity?.pos) continue;
        const ent = actor._entity;
        aliveEntities.add(ent);

        let list = history.get(ent);
        if (!list) {
          list = [];
          history.set(ent, list);
        }

        const x = Number(ent.pos[0]) || 0;
        const y = Number(ent.pos[1]) || 0;
        const z = Number(ent.pos[2]) || 0;
        const h = Number(ent.h) > 0.2 ? Number(ent.h) : 1.8;

        list.push({ ts: now, x, y, z, h });
        while (list.length > 0 && list[0].ts < cutoff) {
          list.shift();
        }
        if (list.length > 48) {
          list.splice(0, list.length - 48);
        }

        // Pick snapshot closest to player's crosshair line (that is visible if wallCheck)
        let best = null;
        let bestAngle = Infinity;
        for (let i = 0; i < list.length; i++) {
          const snap = list[i];
          const aimPt = { x: snap.x, y: snap.y + snap.h * 0.78, z: snap.z };
          const dx = aimPt.x - eye.x;
          const dy = aimPt.y - eye.y;
          const dz = aimPt.z - eye.z;
          const dist = Math.hypot(dx, dy, dz);
          if (dist < 0.1) continue;
          const dot = Math.max(-1, Math.min(1, (dx * fwdX + dy * fwdY + dz * fwdZ) / dist));
          const angle = Math.acos(dot);
          if (angle >= bestAngle) continue;
          if (wallCheck && !bridge.worldLineClear(eye, aimPt)) continue;
          bestAngle = angle;
          best = snap;
        }

        if (best) {
          const moved = Math.hypot(best.x - x, best.y - y, best.z - z);
          if (moved > 0.08) {
            activeBacktracks.set(ent, best);
          }
        }
      }

      for (const ent of history.keys()) {
        if (!aliveEntities.has(ent)) {
          history.delete(ent);
        }
      }

      if (!showGhost || activeBacktracks.size === 0) {
        clearOverlay();
        return;
      }

      ensureOverlay();
      if (!overlayCtx) return;
      overlayCtx.clearRect(0, 0, overlayW, overlayH);
      hadContent = true;

      const camEye = camera.position;
      const camFwd = player.pos.clone();
      camera.getWorldDirection(camFwd);
      const pt = player.pos.clone();

      const projectPt = (wx, wy, wz) => {
        pt.set(wx, wy, wz);
        const dx = pt.x - camEye.x;
        const dy = pt.y - camEye.y;
        const dz = pt.z - camEye.z;
        if (dx * camFwd.x + dy * camFwd.y + dz * camFwd.z <= 0.1) return null;
        pt.project(camera);
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y) || pt.z < -1 || pt.z > 1) return null;
        return [(pt.x * 0.5 + 0.5) * overlayW, (-pt.y * 0.5 + 0.5) * overlayH];
      };

      const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
      const hw = 0.34;

      for (const snap of activeBacktracks.values()) {
        const { x, y, z, h } = snap;
        const c = [
          projectPt(x - hw, y, z - hw), projectPt(x + hw, y, z - hw),
          projectPt(x + hw, y, z + hw), projectPt(x - hw, y, z + hw),
          projectPt(x - hw, y + h, z - hw), projectPt(x + hw, y + h, z - hw),
          projectPt(x + hw, y + h, z + hw), projectPt(x - hw, y + h, z + hw)
        ];
        if (!c.some((v) => !v)) {
          overlayCtx.strokeStyle = 'rgba(0, 238, 255, 0.85)';
          overlayCtx.lineWidth = 1.4;
          overlayCtx.beginPath();
          for (const [a, b] of edges) {
            overlayCtx.moveTo(c[a][0], c[a][1]);
            overlayCtx.lineTo(c[b][0], c[b][1]);
          }
          overlayCtx.stroke();
        }

        const head2d = projectPt(x, y + h * 0.78, z);
        if (head2d) {
          const [hx, hy] = head2d;
          overlayCtx.fillStyle = 'rgba(0, 238, 255, 0.95)';
          overlayCtx.beginPath();
          overlayCtx.moveTo(hx, hy - 4);
          overlayCtx.lineTo(hx + 4, hy);
          overlayCtx.lineTo(hx, hy + 4);
          overlayCtx.lineTo(hx - 4, hy);
          overlayCtx.closePath();
          overlayCtx.fill();
        }
      }
    }

    function installTriggerHook() {
      const xz = window.XZ;
      if (!xz || typeof xz.trigger !== 'function' || xz.trigger.__solsticeBacktrack) {
        return;
      }
      const origTrigger = xz.trigger;
      const wrappedTrigger = function backtrackTrigger(...args) {
        if (!enabled || activeBacktracks.size === 0 || (onlyAura && !isAuraFresh())) {
          return origTrigger.apply(this, args);
        }

        const saved = [];
        for (const [ent, snap] of activeBacktracks) {
          if (!ent || ent.dead || !ent.pos || ent.pos.length < 3) continue;
          saved.push([ent, ent.pos[0], ent.pos[1], ent.pos[2]]);
          ent.pos[0] = snap.x;
          ent.pos[1] = snap.y;
          ent.pos[2] = snap.z;
        }

        try {
          return origTrigger.apply(this, args);
        } finally {
          for (let i = 0; i < saved.length; i++) {
            const [ent, ox, oy, oz] = saved[i];
            ent.pos[0] = ox;
            ent.pos[1] = oy;
            ent.pos[2] = oz;
          }
        }
      };
      Object.defineProperty(wrappedTrigger, '__solsticeBacktrack', { value: true });
      xz.trigger = wrappedTrigger;
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'backtrack') return;
      enabled = Boolean(data.enabled);
      maxWindowMs = Math.max(50, Math.min(450, Number(data.maxWindowMs) || 250));
      onlyAura = Boolean(data.onlyAura);
      wallCheck = data.wallCheck !== false;
      showGhost = data.showGhost !== false;
      if (!enabled) {
        history.clear();
        activeBacktracks.clear();
        clearOverlay();
      }
    });

    if (typeof bridge.onReset === 'function') {
      bridge.onReset(() => {
        history.clear();
        activeBacktracks.clear();
        clearOverlay();
      });
    }

    if (typeof bridge.provide === 'function') {
      bridge.provide('backtrack', {
        isActive: () => Boolean(enabled && (!onlyAura || isAuraFresh())),
        getAimPoint(actor) {
          if (!enabled || (onlyAura && !isAuraFresh()) || !actor?._entity) return null;
          const snap = activeBacktracks.get(actor._entity);
          if (!snap) return null;
          return { x: snap.x, y: snap.y + snap.h * 0.78, z: snap.z, snap };
        }
      });
    }

    installTriggerHook();
    setInterval(installTriggerHook, 500);
    bridge.onBeforePlayerUpdate(recordAndSelect);
  }
})();
