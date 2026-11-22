(() => {
  'use strict';

  const CHANNEL = 'solstice-targethud';
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
  let currentTarget = null;
  let lastTargetAt = 0;
  let animHp = 100;
  let animAlpha = 0;

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
    const module = getMod('TargetHUD');

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
      enabled: Boolean(module.on)
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
    if (event.origin !== GAME_ORIGIN || event.data?.channel !== CHANNEL || event.data.type !== 'target') {
      return;
    }

    const frame = findGameFrame();

    if (!frame || event.source !== frame.contentWindow) {
      return;
    }

    currentTarget = event.data.target || null;
    lastTargetAt = performance.now();
  });

  function drawTargetHUD(dt) {
    syncConfig();

    const module = getMod('TargetHUD');
    const now = performance.now();

    if (currentTarget && now - lastTargetAt > 1200) {
      currentTarget = null;
    }

    const preview = S.hudEditor && module?.on ? {
      name: 'Target Preview',
      hp: 76,
      dist: 14,
      weapon: 'ar',
      reloading: true,
      cheater: false,
      ircName: ''
    } : null;

    const data = module?.on ? (currentTarget || preview) : null;
    animAlpha = clamp(animate(data ? 1 : 0, animAlpha, dt * 12), 0, 1);

    if (animAlpha < 0.02) {
      return;
    }

    const showTarget = data || currentTarget || preview || {
      name: 'Target',
      hp: animHp,
      dist: 0,
      weapon: '',
      reloading: false,
      cheater: false,
      ircName: ''
    };

    animHp = animate(clamp(Number(showTarget.hp) || 0, 0, 100), animHp, dt * 14);

    const width = 220;
    const height = 66;

    ctx.save();
    ctx.scale(K, K);
    const AW = W / K;
    const AH = H / K;
    const layout = hudElement('TargetHUD', Math.round(AW * 0.5 + 32), Math.round(AH * 0.5 - 33), width, height);
    layout.w = width;
    layout.h = height;
    hudApplyScale(layout);

    const x = layout.x;
    const y = layout.y;
    const accent = showTarget.cheater
      ? [255, 159, 28]
      : showTarget.ircName
        ? [64, 156, 255]
        : themed(x + y);

    if (setting(module, 'Background', true)) {
      fillRR(x, y, width, height, 8, [12, 14, 20], 0.78 * animAlpha, CORNER_TOP | CORNER_BOTTOM);
      fillRR(x, y + 8, 3, height - 16, 2, accent, 0.95 * animAlpha, CORNER_TOP | CORNER_BOTTOM);
    }

    const padX = x + 12;
    const tagPrefix = showTarget.cheater ? '[AC] ' : showTarget.ircName ? `[${showTarget.ircName}] ` : '';
    const title = `${tagPrefix}${showTarget.name || 'Enemy'}`;

    setFont(15, true);
    ctx.fillStyle = rgb(showTarget.cheater ? [255, 180, 70] : [255, 255, 255], animAlpha);
    ctx.fillText(title, padX, y + 10);

    const metaParts = [];

    if (setting(module, 'Show Weapon', true) && showTarget.weapon) {
      const wKey = String(showTarget.weapon).toLowerCase();
      const wLabel = wKey === 'ar' ? 'KR7'
        : wKey === 'smg' ? 'VESPER9'
          : wKey === 'shotgun' ? 'M12'
            : wKey === 'pistol' ? 'STRIX9'
              : wKey.toUpperCase();
      metaParts.push(wLabel);
    }

    if (setting(module, 'Show Distance', true) && Number.isFinite(showTarget.dist)) {
      metaParts.push(`${Math.round(showTarget.dist)}m`);
    }

    if (metaParts.length > 0) {
      const meta = metaParts.join('  •  ');
      setFont(12, false);
      ctx.fillStyle = rgb([185, 195, 210], 0.9 * animAlpha);
      ctx.fillText(meta, padX, y + 29);
    }

    if (setting(module, 'Show Reload', true) && showTarget.reloading) {
      const badgeText = 'RELOADING';
      setFont(11, true);
      const bw = tw(badgeText, 11, true) + 10;
      const bx = x + width - bw - 10;
      const by = y + 27;
      fillRR(bx, by, bw, 16, 4, [245, 158, 11], 0.25 * animAlpha, CORNER_TOP | CORNER_BOTTOM);
      ctx.fillStyle = rgb([251, 191, 36], animAlpha);
      ctx.fillText(badgeText, bx + 5, by + 2);
    }

    const barX = padX;
    const barY = y + height - 16;
    const barW = width - 22;
    const barH = 6;
    const ratio = clamp(animHp / 100, 0, 1);
    const hpColor = animHp > 60 ? [74, 222, 128] : animHp > 30 ? [250, 204, 21] : [239, 68, 68];

    fillRR(barX, barY, barW, barH, 3, [255, 255, 255], 0.14 * animAlpha, CORNER_TOP | CORNER_BOTTOM);

    if (ratio > 0.01) {
      fillRR(barX, barY, Math.max(4, barW * ratio), barH, 3, hpColor, 0.95 * animAlpha, CORNER_TOP | CORNER_BOTTOM);
    }

    setFont(12, true);
    const hpLabel = `${Math.round(animHp)} HP`;
    const hpW = tw(hpLabel, 12, true);
    ctx.fillStyle = rgb([230, 235, 245], 0.92 * animAlpha);
    ctx.fillText(hpLabel, x + width - hpW - 10, y + 11);

    ctx.restore();
  }

  register({
    name: 'TargetHUD',
    desc: 'Displays a HUD card for your current combat target.',
    cat: 'Visual',
    nm: { l: 'targethud', ls: 'target hud', n: 'TargetHUD', ns: 'Target HUD' },
    disp: '',
    settings: [
      { t: 'b', n: 'Show Weapon', d: 'Show the target current weapon.', v: 1 },
      { t: 'b', n: 'Show Reload', d: 'Show a badge when the target is reloading.', v: 1 },
      { t: 'b', n: 'Show Distance', d: 'Show distance to the target.', v: 1 },
      { t: 'b', n: 'Background', d: 'Draw dark card background.', v: 1 }
    ],
    renderOrder: 6,
    onRender: drawTargetHUD,
    onEnable() {
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
    let lastPostAt = 0;

    function sendTarget(targetObj) {
      try {
        window.parent.postMessage({
          channel: CHANNEL,
          type: 'target',
          target: targetObj
        }, OUTER_ORIGIN);
      } catch {

      }
    }

    function tick() {
      if (!enabled) {
        return;
      }

      const now = performance.now();

      if (now - lastPostAt < 33) {
        return;
      }

      lastPostAt = now;
      const gh = bridge.getGH();
      const debug = gh?.debug;
      const player = debug?.player;

      if (!gh?.ready || gh.G?.state !== 'playing' || !player?.pos) {
        sendTarget(null);
        return;
      }

      const aura = typeof bridge.getFeature === 'function' ? bridge.getFeature('aura') : null;
      let target = aura && typeof aura.getTarget === 'function' ? aura.getTarget() : null;

      if (!target || target.alive === false || !target.pos) {
        target = null;
      }

      if (!target) {
        const actors = debug?.match?.actors;

        if (Array.isArray(actors)) {
          let bestDistSq = 40 * 40;

          for (const actor of actors) {
            if (!actor?.pos || actor.alive === false || !bridge.isEnemy(actor, player)) {
              continue;
            }

            const dx = actor.pos.x - player.pos.x;
            const dy = actor.pos.y - player.pos.y;
            const dz = actor.pos.z - player.pos.z;
            const dSq = dx * dx + dy * dy + dz * dz;

            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              target = actor;
            }
          }
        }
      }

      if (!target) {
        sendTarget(null);
        return;
      }

      const snap = bridge.getRawSnapshot?.();
      const snapPlayer = Array.isArray(snap?.players)
        ? snap.players.find((p) => p && p.id != null && String(p.id) === String(target.id))
        : null;
      const ac = typeof bridge.getFeature === 'function' ? bridge.getFeature('anticheat') : null;
      const irc = typeof bridge.getFeature === 'function' ? bridge.getFeature('irc') : null;
      const acInfo = ac && typeof ac.getInfo === 'function' ? ac.getInfo(target) : null;
      const ircInfo = irc && typeof irc.getIrcInfo === 'function' ? irc.getIrcInfo(target) : null;
      const dist = Math.hypot(
        target.pos.x - player.pos.x,
        target.pos.y - player.pos.y,
        target.pos.z - player.pos.z
      );

      sendTarget({
        name: target.name || 'Enemy',
        hp: Number.isFinite(Number(snapPlayer?.hp)) ? Number(snapPlayer.hp) : Number(target.health ?? 100),
        dist,
        weapon: snapPlayer?.weapon || target.weapon || '',
        reloading: Boolean(snapPlayer && snapPlayer.reload > 0),
        cheater: Boolean(acInfo),
        ircName: ircInfo?.ircName || ''
      });
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }

      enabled = Boolean(data.enabled);

      if (!enabled) {
        sendTarget(null);
      }
    });

    bridge.onBeforePlayerUpdate(tick, 10);
    bridge.onReset(() => sendTarget(null));
  }
})();
