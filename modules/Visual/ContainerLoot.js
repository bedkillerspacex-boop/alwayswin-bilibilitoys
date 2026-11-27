(() => {
  'use strict';

  /* ContainerLoot：搜打撤容器透视 + 地上物品透视 + 稀有度过滤 + 秒开容器 */

  const CHANNEL = 'solstice-containerloot';
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

  function setting(mod, name, fallback) {
    const entry = mod?.settings?.find((s) => s.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig() {
    const mod = typeof getMod === 'function' ? getMod('ContainerLoot') : null;
    if (!mod) return;

    const now = performance.now();
    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) return;

    const cfg = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(mod.on),
      distance: Math.max(8, Math.min(256, Number(setting(mod, 'Display distance', 64)) || 64)),
      maxItems: Math.max(1, Math.min(24, Number(setting(mod, 'Max items per container', 8)) || 8)),
      instantSearch: Boolean(setting(mod, 'Instant Search', true)),
      showContainers: Boolean(setting(mod, 'Show Containers', true)),
      showGround: Boolean(setting(mod, 'Show Ground', true)),
      rarities: [
        Boolean(setting(mod, 'Common', false)),
        Boolean(setting(mod, 'Uncommon', false)),
        Boolean(setting(mod, 'Rare', false)),
        Boolean(setting(mod, 'Epic', true)),
        Boolean(setting(mod, 'Legendary', true)),
        Boolean(setting(mod, 'Mythic', true))
      ]
    };

    const key = JSON.stringify(cfg);
    if (key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) return;

    const frame = findGameFrame();
    if (!frame?.contentWindow) return;

    frame.contentWindow.postMessage(cfg, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    game: 'potatoepic',
    name: 'ContainerLoot',
    desc: 'Shows container & ground loot in xzext with rarity filter and instant search.',
    cat: 'Visual',
    nm: { l: 'containerloot', ls: 'container loot', n: 'ContainerLoot', ns: 'Container Loot' },
    disp: '',
    settings: [
      { t: 'n', n: 'Display distance', d: 'Max render distance in blocks.', v: 64, min: 8, max: 256, step: 4 },
      { t: 'n', n: 'Max items per container', d: 'Max items shown per container.', v: 8, min: 1, max: 24, step: 1 },
      { t: 'b', n: 'Instant Search', d: 'Open containers without waiting for the search bar.', v: 1 },
      { t: 'b', n: 'Show Containers', d: 'Show items inside boxes, safes, airdrops and bodies.', v: 1 },
      { t: 'b', n: 'Show Ground', d: 'Show dropped items on the ground.', v: 1 },
      { t: 'b', n: 'Common', d: 'Show Common (white) items.', v: 0 },
      { t: 'b', n: 'Uncommon', d: 'Show Uncommon (green) items.', v: 0 },
      { t: 'b', n: 'Rare', d: 'Show Rare (blue) items.', v: 0 },
      { t: 'b', n: 'Epic', d: 'Show Epic (purple) items.', v: 1 },
      { t: 'b', n: 'Legendary', d: 'Show Legendary (gold) items.', v: 1 },
      { t: 'b', n: 'Mythic', d: 'Show Mythic (red) items.', v: 1 }
    ],
    onRender: syncConfig,
    onEnable() {}
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
    const RAR_COLORS = ['#cbd5e1', '#4ade80', '#60a5fa', '#c084fc', '#fbbf24', '#f87171'];

    let config = {
      enabled: false,
      distance: 64,
      maxItems: 8,
      instantSearch: true,
      showContainers: true,
      showGround: true,
      rarities: [false, false, false, true, true, true]
    };

    let overlayCanvas = null;
    let overlayCtx = null;
    let overlayWidth = 0;
    let overlayHeight = 0;
    let overlayDpr = 1;
    let hadContent = false;

    function ensureOverlay() {
      if (overlayCanvas && overlayCtx) {
        if (!overlayCanvas.isConnected && document.documentElement) {
          document.documentElement.append(overlayCanvas);
        }
        return overlayCanvas.isConnected;
      }
      if (!document.documentElement) return false;
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.id = 'solstice-containerloot-overlay';
      overlayCanvas.setAttribute('aria-hidden', 'true');
      overlayCanvas.style.cssText = 'position:fixed;inset:0;display:block;width:100vw;height:100vh;pointer-events:none;z-index:2147483645';
      document.documentElement.append(overlayCanvas);
      overlayCtx = overlayCanvas.getContext('2d');
      resizeCanvas();
      return Boolean(overlayCtx);
    }

    function resizeCanvas() {
      if (!overlayCanvas || !overlayCtx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (overlayCanvas.width !== pw || overlayCanvas.height !== ph) {
        overlayCanvas.width = pw;
        overlayCanvas.height = ph;
      }
      overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      overlayWidth = w;
      overlayHeight = h;
      overlayDpr = dpr;
    }

    function clearOverlay() {
      if (!overlayCtx || !hadContent) return;
      overlayCtx.clearRect(0, 0, overlayWidth, overlayHeight);
      hadContent = false;
    }

    function applyInstantSearch() {
      if (!config.enabled || !config.instantSearch) return;
      const xzeR = window.XZE?.R;
      const openBox = xzeR?.open?.b;
      if (openBox && !openBox.opened) {
        openBox.openT = performance.now() - 1e6;
      }
    }

    function draw() {
      if (!config.enabled || bridge.uiOpen) {
        clearOverlay();
        return;
      }

      applyInstantSearch();

      if (!ensureOverlay()) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (window.innerWidth !== overlayWidth || window.innerHeight !== overlayHeight || dpr !== overlayDpr) {
        resizeCanvas();
      }
      clearOverlay();

      const xze = window.XZE;
      const xzeR = xze?.R;
      if (!xze || !xzeR || xzeR.st !== 'play') return;

      const gh = bridge.getGH();
      const camera = gh?.debug?.gfx?.camera;
      const player = gh?.debug?.player;
      if (!camera || !player?.pos) return;

      const point = player.pos.clone();
      const forward = player.pos.clone();
      camera.getWorldDirection(forward);

      const entries = [];
      const maxDist = config.distance;

      const mapConts = xze.MAPS?.[xzeR.map]?.conts;
      if (config.showContainers && Array.isArray(mapConts) && Array.isArray(xzeR.boxes)) {
        const conts = mapConts;
        const boxes = xzeR.boxes;
        for (let i = 0; i < conts.length; i++) {
          const c = conts[i];
          const b = boxes[i];
          if (!c || !b?.g?.items?.length) continue;
          entries.push({
            x: Number(c.x) + 0.5,
            y: Number(c.y) + 0.85,
            z: Number(c.z) + 0.5,
            title: b.kind?.cn || xze.CONT?.[c.kind]?.cn || '容器',
            items: b.g.items
          });
        }
      }

      if (Array.isArray(xzeR.dyn)) {
        for (const d of xzeR.dyn) {
          if (!d || d.alias || !d.g?.items?.length || !Array.isArray(d.pos)) continue;
          const isDrop = d.kind === xze.CONT?.drop;
          if (isDrop && !config.showGround) continue;
          if (!isDrop && !config.showContainers) continue;
          entries.push({
            x: Number(d.pos[0]) || 0,
            y: (Number(d.pos[1]) || 0) + 0.55,
            z: Number(d.pos[2]) || 0,
            title: isDrop ? '地上物品' : (d.kind?.cn || '容器'),
            items: d.g.items
          });
        }
      }

      overlayCtx.font = '600 11px system-ui, -apple-system, sans-serif';
      overlayCtx.textBaseline = 'top';
      overlayCtx.textAlign = 'left';

      for (const entry of entries) {
        const dist = Math.hypot(entry.x - player.pos.x, entry.y - player.pos.y, entry.z - player.pos.z);
        if (dist > maxDist) continue;

        const filtered = [];
        for (const slot of entry.items) {
          const it = slot?.it;
          if (!it) continue;
          const r = Math.max(0, Math.min(5, Number(xze.rar?.(it)) || 0));
          if (!config.rarities[r]) continue;
          const label = (typeof xze.name === 'function' ? xze.name(it) : null) || it.k || 'Item';
          const count = Number(it.n) > 1 ? ` x${it.n}` : '';
          filtered.push({ r, text: `${label}${count}` });
        }
        if (filtered.length === 0) continue;

        filtered.sort((a, b) => b.r - a.r);
        const shown = filtered.slice(0, config.maxItems);

        point.set(entry.x, entry.y, entry.z);
        const dx = point.x - camera.position.x;
        const dy = point.y - camera.position.y;
        const dz = point.z - camera.position.z;
        if (dx * forward.x + dy * forward.y + dz * forward.z <= 0.1) continue;

        point.project(camera);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.z < -1 || point.z > 1) continue;

        const sx = (point.x * 0.5 + 0.5) * overlayWidth;
        const sy = (-point.y * 0.5 + 0.5) * overlayHeight;

        const header = `${entry.title} [${Math.round(dist)}m]`;
        let maxW = overlayCtx.measureText(header).width;
        for (const row of shown) {
          const w = overlayCtx.measureText(row.text).width;
          if (w > maxW) maxW = w;
        }

        const lineH = 14;
        const padX = 6;
        const padY = 4;
        const boxW = maxW + padX * 2;
        const boxH = (1 + shown.length) * lineH + padY * 2;
        const boxX = sx - boxW * 0.5;
        const boxY = sy - boxH;

        overlayCtx.fillStyle = 'rgba(10, 12, 18, 0.78)';
        overlayCtx.fillRect(boxX, boxY, boxW, boxH);
        overlayCtx.strokeStyle = RAR_COLORS[shown[0].r] || '#60a5fa';
        overlayCtx.lineWidth = 1;
        overlayCtx.strokeRect(boxX, boxY, boxW, boxH);

        overlayCtx.fillStyle = '#e2e8f0';
        overlayCtx.fillText(header, boxX + padX, boxY + padY);
        for (let i = 0; i < shown.length; i++) {
          overlayCtx.fillStyle = RAR_COLORS[shown[i].r] || '#cbd5e1';
          overlayCtx.fillText(shown[i].text, boxX + padX, boxY + padY + (i + 1) * lineH);
        }

        hadContent = true;
      }
    }

    function loop() {
      window.requestAnimationFrame(loop);
      try {
        draw();
      } catch {}
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') return;
      config = {
        enabled: Boolean(data.enabled),
        distance: Math.max(8, Math.min(256, Number(data.distance) || 64)),
        maxItems: Math.max(1, Math.min(24, Number(data.maxItems) || 8)),
        instantSearch: data.instantSearch !== false,
        showContainers: data.showContainers !== false,
        showGround: data.showGround !== false,
        rarities: Array.isArray(data.rarities) && data.rarities.length === 6
          ? data.rarities.map(Boolean)
          : config.rarities
      };
      if (!config.enabled) clearOverlay();
    });

    bridge.onReset(() => clearOverlay());
    window.addEventListener('resize', resizeCanvas);
    window.requestAnimationFrame(loop);
  }
})();
