(() => {
  'use strict';

  const CHANNEL = 'solstice-movement';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 400;

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

  function setting(mod, name, fallback) {
    const entry = mod?.settings?.find((s) => s.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig(force = false) {
    const mod = getMod('Blink');
    if (!mod) return;

    const modeSetting = mod.settings.find((s) => s.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] === 'Pulse' ? 'Pulse' : 'Normal';
    mod.disp = mode;

    const now = performance.now();
    const payload = {
      channel: CHANNEL,
      type: 'config',
      module: 'blink',
      enabled: Boolean(mod.on),
      mode,
      pulseDelay: Math.max(50, Math.min(3000, Number(setting(mod, 'Pulse Delay', 300)) || 300)),
      maxPackets: Math.max(20, Math.min(500, Number(setting(mod, 'Max Packets', 180)) || 180)),
      onlyMove: Boolean(setting(mod, 'Only Move', 1)),
      showGhost: Boolean(setting(mod, 'Show Ghost', 1))
    };
    const key = JSON.stringify(payload);
    if (!force && key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const frame = findGameFrame();
    if (!frame?.contentWindow) return;

    frame.contentWindow.postMessage(payload, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    game: 'potatoepic',
    name: 'Blink',
    desc: 'Delays outgoing movement packets and flushes them in a burst or at intervals.',
    cat: 'Movement',
    nm: { l: 'blink', ls: 'blink', n: 'Blink', ns: 'Blink' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'Normal holds until disabled; Pulse flushes periodically.', v: 0, vals: ['Normal', 'Pulse'] },
      { t: 'n', n: 'Pulse Delay', d: 'Flush interval in ms when Mode is Pulse.', v: 300, min: 50, max: 3000, step: 10 },
      { t: 'n', n: 'Max Packets', d: 'Auto-flush when queued packet count reaches this limit.', v: 180, min: 20, max: 500, step: 10 },
      { t: 'b', n: 'Only Move', d: 'Only buffer movement/state packets and let combat/control packets pass.', v: 1 },
      { t: 'b', n: 'Show Ghost', d: 'Show a wireframe box at your last server-synced position.', v: 1 }
    ],
    onRender: () => syncConfig(false),
    defaultOn: false,
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
    let mode = 'Normal';
    let pulseDelay = 300;
    let maxPackets = 180;
    let onlyMove = true;
    let showGhost = true;

    const queue = [];
    let lastFlushAt = 0;
    let ghostPos = null;
    let wsHooked = false;
    let rtcHooked = false;

    let overlayCanvas = null;
    let overlayCtx = null;
    let overlayW = 0;
    let overlayH = 0;
    let overlayDpr = 1;
    let hadGhost = false;

    function shouldBuffer(data) {
      if (typeof data !== 'string') return false;
      if (data.includes('"t":"ping"') || data.includes('"t":"pong"') || data.includes('"t":"ic"') || data.includes('"t":"hi"')) {
        return false;
      }
      if (!onlyMove) return true;
      return (
        data.includes('"t":"s"') ||
        data.includes('"t":"move"') ||
        data.includes('"t":"pos"') ||
        data.includes('"t":"glide"')
      );
    }

    function captureGhost() {
      const p = window.game?.player;
      if (p?.pos && p.pos.length >= 3) {
        ghostPos = {
          x: Number(p.pos[0]) || 0,
          y: Number(p.pos[1]) || 0,
          z: Number(p.pos[2]) || 0,
          h: Number(p.h) > 0.2 ? Number(p.h) : 1.8
        };
      }
    }

    function flush() {
      lastFlushAt = performance.now();
      if (!queue.length) return;
      const items = queue.splice(0, queue.length);
      for (const item of items) {
        try {
          if (item.target && typeof item.target.readyState === 'number' && item.target.readyState !== 1) continue;
          if (item.target && typeof item.target.readyState === 'string' && item.target.readyState !== 'open') continue;
          item.fn.call(item.target, item.data);
        } catch {}
      }
      if (enabled) captureGhost();
      else ghostPos = null;
    }

    function installNetworkHooks() {
      if (!wsHooked && typeof WebSocket === 'function') {
        wsHooked = true;
        const origWsSend = WebSocket.prototype.send;
        const wrappedWs = function blinkWsSend(data) {
          if (enabled && window.game?.state === 'play' && shouldBuffer(data)) {
            if (!ghostPos) captureGhost();
            queue.push({ target: this, fn: origWsSend, data });
            if (queue.length >= maxPackets) flush();
            return;
          }
          return origWsSend.call(this, data);
        };
        Object.defineProperty(wrappedWs, '__solsticeBlink', { value: true });
        WebSocket.prototype.send = wrappedWs;
      }

      if (!rtcHooked && typeof RTCDataChannel === 'function') {
        rtcHooked = true;
        const origRtcSend = RTCDataChannel.prototype.send;
        const wrappedRtc = function blinkRtcSend(data) {
          if (enabled && window.game?.state === 'play' && shouldBuffer(data)) {
            if (!ghostPos) captureGhost();
            queue.push({ target: this, fn: origRtcSend, data });
            if (queue.length >= maxPackets) flush();
            return;
          }
          return origRtcSend.call(this, data);
        };
        Object.defineProperty(wrappedRtc, '__solsticeBlink', { value: true });
        RTCDataChannel.prototype.send = wrappedRtc;
      }
    }

    function ensureOverlay() {
      if (!overlayCanvas) {
        overlayCanvas = document.createElement('canvas');
        overlayCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483641;';
        document.documentElement.appendChild(overlayCanvas);
        overlayCtx = overlayCanvas.getContext('2d');
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      if (overlayCtx && hadGhost) {
        overlayCtx.clearRect(0, 0, overlayW, overlayH);
        hadGhost = false;
      }
    }

    function drawGhost() {
      if (!enabled || !showGhost || !ghostPos || window.game?.state !== 'play' || window.game?.ui?.screen) {
        clearOverlay();
        return;
      }
      const ctxInfo = bridge.getContext();
      if (!ctxInfo?.camera) {
        clearOverlay();
        return;
      }
      ensureOverlay();
      if (!overlayCtx) return;
      overlayCtx.clearRect(0, 0, overlayW, overlayH);
      hadGhost = true;

      const cam = ctxInfo.camera;
      const eye = cam.position;
      const fwd = ctxInfo.player.pos.clone();
      cam.getWorldDirection(fwd);

      const pt = ctxInfo.player.pos.clone();
      const proj = (wx, wy, wz) => {
        pt.set(wx, wy, wz);
        const dx = pt.x - eye.x, dy = pt.y - eye.y, dz = pt.z - eye.z;
        if (dx * fwd.x + dy * fwd.y + dz * fwd.z <= 0.1) return null;
        pt.project(cam);
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y) || pt.z < -1 || pt.z > 1) return null;
        return [(pt.x * 0.5 + 0.5) * overlayW, (-pt.y * 0.5 + 0.5) * overlayH];
      };

      const hw = 0.32;
      const { x, y, z, h } = ghostPos;
      const c = [
        proj(x - hw, y, z - hw), proj(x + hw, y, z - hw),
        proj(x + hw, y, z + hw), proj(x - hw, y, z + hw),
        proj(x - hw, y + h, z - hw), proj(x + hw, y + h, z - hw),
        proj(x + hw, y + h, z + hw), proj(x - hw, y + h, z + hw)
      ];
      if (c.some((v) => !v)) return;

      const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
      overlayCtx.strokeStyle = 'rgba(255, 196, 0, 0.85)';
      overlayCtx.lineWidth = 1.5;
      overlayCtx.beginPath();
      for (const [a, b] of edges) {
        overlayCtx.moveTo(c[a][0], c[a][1]);
        overlayCtx.lineTo(c[b][0], c[b][1]);
      }
      overlayCtx.stroke();
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'blink') return;
      const wasEnabled = enabled;
      enabled = Boolean(data.enabled);
      mode = data.mode === 'Pulse' ? 'Pulse' : 'Normal';
      pulseDelay = Math.max(50, Math.min(3000, Number(data.pulseDelay) || 300));
      maxPackets = Math.max(20, Math.min(500, Number(data.maxPackets) || 180));
      onlyMove = data.onlyMove !== false;
      showGhost = data.showGhost !== false;

      if (enabled && !wasEnabled) {
        lastFlushAt = performance.now();
        captureGhost();
      } else if (!enabled && wasEnabled) {
        flush();
        clearOverlay();
      }
    });

    if (typeof bridge.onReset === 'function') {
      bridge.onReset(() => {
        flush();
        ghostPos = null;
        clearOverlay();
      });
    }

    installNetworkHooks();
    setInterval(() => {
      installNetworkHooks();
      if (enabled && mode === 'Pulse' && queue.length && performance.now() - lastFlushAt >= pulseDelay) {
        flush();
      }
    }, 30);

    bridge.onBeforePlayerUpdate(drawGhost);
  }
})();
