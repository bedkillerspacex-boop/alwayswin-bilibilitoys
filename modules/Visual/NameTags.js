(() => {
  'use strict';

  /* NameTags：在玩家头顶绘制名称标签
     - 队友：绿色（#40ff70）
     - 敌人：红色（#ff4848）
     - IRC 用户：蓝色（#409cff），格式为 [ircname]name */

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-nametags';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 100;
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
    const entry = module.settings.find((s) => s.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig() {
    const module = getMod('NameTags');

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
      enabled: Boolean(module.on),
      local: Boolean(setting(module, 'Show Self', false)),
      friends: Boolean(setting(module, 'Show Friends', true)),
      scale: Math.max(0.6, Math.min(2, Number(setting(module, 'Scale', 1)) || 1))
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
    name: 'NameTags',
    desc: 'Draws player name tags above heads (Green: Teammate, Red: Enemy, Blue: IRC).',
    cat: 'Visual',
    nm: { l: 'nametags', ls: 'name tags', n: 'NameTags', ns: 'Name Tags' },
    disp: '',
    settings: [
      { t: 'b', n: 'Show Self', d: 'Render a name tag above your own player.', v: 0 },
      { t: 'b', n: 'Show Friends', d: 'Render name tags above teammates.', v: 1 },
      { t: 'n', n: 'Scale', d: 'Text scale multiplier.', v: 1.0, min: 0.6, max: 2.0, step: 0.05 }
    ],
    onRender: syncConfig,
    onEnable() {}
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
    const FRIEND_COLOR = '#40ff70';
    const ENEMY_COLOR = '#ff4848';
    const IRC_COLOR = '#409cff';

    let config = {
      enabled: false,
      local: false,
      friends: true,
      scale: 1
    };

    let overlayCanvas = null;
    let overlayCtx = null;
    let overlayWidth = 0;
    let overlayHeight = 0;
    let renderHookInstalled = false;

    function ensureOverlay() {
      if (overlayCanvas && overlayCtx) {
        return true;
      }

      if (!document.body) {
        return false;
      }

      overlayCanvas = document.createElement('canvas');
      overlayCanvas.id = 'solstice-nametags-overlay';
      overlayCanvas.style.cssText = [
        'position:fixed',
        'inset:0',
        'width:100%',
        'height:100%',
        'pointer-events:none',
        'z-index:9998'
      ].join(';');

      document.body.appendChild(overlayCanvas);
      overlayCtx = overlayCanvas.getContext('2d');
      resizeCanvas();
      return Boolean(overlayCtx);
    }

    function resizeCanvas() {
      if (!overlayCanvas || !overlayCtx) {
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    }

    function clearOverlay() {
      if (!overlayCtx) {
        return;
      }

      overlayCtx.clearRect(0, 0, overlayWidth, overlayHeight);
    }

    function draw() {
      if (!ensureOverlay()) {
        return;
      }

      resizeCanvas();
      clearOverlay();

      if (!config.enabled || bridge.uiOpen) {
        return;
      }

      const gh = bridge.getGH();

      if (!gh?.ready || gh.G.state !== 'playing') {
        return;
      }

      const debug = gh.debug;
      const camera = debug?.gfx?.camera;
      const player = debug?.player;
      const actors = debug?.match?.actors;

      if (!camera || !player?.pos || !Array.isArray(actors)) {
        return;
      }

      const renderTags = () => {
        const point = player.pos.clone();
        const forward = player.pos.clone();
        camera.getWorldDirection(forward);
        const width = overlayWidth;
        const height = overlayHeight;
        const irc = typeof bridge.getFeature === 'function' ? bridge.getFeature('irc') : null;
        const fontSize = Math.round(13 * config.scale);

        overlayCtx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
        overlayCtx.textAlign = 'center';
        overlayCtx.textBaseline = 'middle';

        for (const actor of actors) {
          if (!actor?.pos || actor.alive === false || actor.isK9) {
            continue;
          }

          const isSelf = actor === player;
          const isFriend = !isSelf && Number(actor.team) === Number(player.team);
          const ircInfo = !isSelf && irc && typeof irc.getIrcInfo === 'function' ? irc.getIrcInfo(actor) : null;

          if (isSelf && !config.local) {
            continue;
          }

          if (isFriend && !config.friends && !ircInfo) {
            continue;
          }

          bridge.headPoint(actor, point);
          point.y += 0.34;

          const dx = point.x - camera.position.x;
          const dy = point.y - camera.position.y;
          const dz = point.z - camera.position.z;

          if (dx * forward.x + dy * forward.y + dz * forward.z <= 0.1) {
            continue;
          }

          point.project(camera);

          if (
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y) ||
            !Number.isFinite(point.z) ||
            point.z < -1 ||
            point.z > 1
          ) {
            continue;
          }

          const sx = (point.x * 0.5 + 0.5) * width;
          const sy = (-point.y * 0.5 + 0.5) * height;
          const baseName = actor.name || (isFriend ? 'Teammate' : 'Enemy');
          const label = ircInfo ? `[${ircInfo.ircName}]${baseName}` : baseName;
          const color = ircInfo ? IRC_COLOR : isFriend ? FRIEND_COLOR : ENEMY_COLOR;
          const padX = 6 * config.scale;
          const boxH = fontSize + 6 * config.scale;
          const textW = overlayCtx.measureText(label).width;
          const boxW = textW + padX * 2;

          overlayCtx.fillStyle = 'rgba(10, 12, 18, 0.72)';
          overlayCtx.fillRect(sx - boxW * 0.5, sy - boxH * 0.5, boxW, boxH);
          overlayCtx.strokeStyle = color;
          overlayCtx.lineWidth = 1;
          overlayCtx.strokeRect(sx - boxW * 0.5, sy - boxH * 0.5, boxW, boxH);
          overlayCtx.fillStyle = color;
          overlayCtx.fillText(label, sx, sy + 0.5);
        }
      };

      const thirdPerson = typeof bridge.getFeature === 'function' ? bridge.getFeature('thirdperson') : null;

      if (thirdPerson && typeof thirdPerson.withCamera === 'function') {
        thirdPerson.withCamera(camera, renderTags);
      } else {
        renderTags();
      }
    }

    function installRenderHook() {
      const gfx = bridge.getGH()?.debug?.gfx;

      if (!gfx || typeof gfx.render !== 'function' || gfx.render.__solsticeNameTagsWrapped) {
        return;
      }

      const originalRender = gfx.render;
      const wrappedRender = function wrappedNameTagsRender(...args) {
        const result = originalRender.apply(this, args);

        try {
          draw();
        } catch {

        }

        return result;
      };

      Object.defineProperty(wrappedRender, '__solsticeNameTagsWrapped', { value: true });
      gfx.render = wrappedRender;
      renderHookInstalled = true;
    }

    function fallbackDrawLoop() {
      window.requestAnimationFrame(fallbackDrawLoop);

      if (!renderHookInstalled) {
        try {
          draw();
        } catch {

        }
      }
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }

      config = {
        enabled: Boolean(data.enabled),
        local: Boolean(data.local),
        friends: data.friends !== false,
        scale: Math.max(0.6, Math.min(2, Number(data.scale) || 1))
      };

      if (!config.enabled) {
        clearOverlay();
      }
    });

    bridge.onReset(() => {
      clearOverlay();
    });

    window.addEventListener('resize', resizeCanvas);
    installRenderHook();
    setInterval(installRenderHook, 500);
    window.requestAnimationFrame(fallbackDrawLoop);
  }
})();
