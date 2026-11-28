(() => {
  'use strict';

  if (location.hostname !== 'www.bilibili.com' || !location.pathname.startsWith('/toy/potatoepic')) {
    return;
  }

  const CHANNEL = 'solstice-levelinfo';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  let fps = 0;
  let requestTimer = 0;
  const state = {
    playing: false,
    x: null,
    y: null,
    z: null,
    bps: 0,
    averageBps: 0,
    ping: null,
    seed: null,
    at: 0
  };

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(GAME_ORIGIN + '/toy/potatoepic/')) {
        return frame;
      }
    }

    return null;
  }

  function requestLevelInfo() {
    const frame = findGameFrame();

    if (!frame?.contentWindow) {
      return;
    }

    try {
      frame.contentWindow.postMessage({
        channel: CHANNEL,
        type: 'request'
      }, GAME_ORIGIN);
    } catch {

    }
  }

  function startRequests() {
    if (requestTimer) {
      return;
    }

    requestLevelInfo();
    requestTimer = setInterval(requestLevelInfo, 250);
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN && event.origin !== 'null') {
      return;
    }

    const data = event.data;

    if (!data || data.channel !== CHANNEL || data.type !== 'state') {
      return;
    }

    state.playing = Boolean(data.playing);
    state.x = Number.isFinite(Number(data.x)) ? Number(data.x) : null;
    state.y = Number.isFinite(Number(data.y)) ? Number(data.y) : null;
    state.z = Number.isFinite(Number(data.z)) ? Number(data.z) : null;
    state.bps = Number(data.bps) || 0;
    state.averageBps = Number(data.averageBps) || 0;
    state.ping = Number.isFinite(Number(data.ping)) ? Number(data.ping) : null;
    state.seed = data.seed == null ? null : String(data.seed);
    state.at = performance.now();
  });

  startRequests();

  function setting(module, name) {
    return Boolean(module.settings.find((item) => item.n === name)?.v);
  }

  function drawLevelInfo(dt) {
    const module = getMod('LevelInfo');

    if (!module?.on) {
      return;
    }

    if (dt > 0) {
      const current = 1 / dt;
      fps = fps ? fps + (current - fps) * 0.12 : current;
    }

    const live = state.at > 0 && performance.now() - state.at <= 2000;
    const lines = [];

    if (setting(module, 'Show FPS')) {
      lines.push('FPS: ' + Math.max(1, Math.round(fps)));
    }

    if (live && setting(module, 'Show Ping')) {
      lines.push('Ping: ' + (state.ping == null ? '--' : Math.round(state.ping) + 'ms'));
    }

    if (live && setting(module, 'Show BPS') && state.x != null) {
      lines.push('BPS: ' + state.bps.toFixed(2) + ' (' + state.averageBps.toFixed(2) + ')');
    }

    if (live && setting(module, 'Show XYZ') && state.x != null) {
      lines.push('XYZ: ' + Math.round(state.x) + '/' + Math.round(state.y) + '/' + Math.round(state.z));
    }

    if (live && setting(module, 'Show Seed') && state.seed != null) {
      lines.push('Seed: ' + state.seed);
    }

    if (!lines.length) {
      return;
    }

    const screenHeight = H > 0 ? H / K : window.innerHeight;
    const lineHeight = 22;
    const maxLines = 5;
    const layout = hudElement('LevelInfo', 20, screenHeight - 160, 240, maxLines * lineHeight);
    const px = layout.x;
    const bottom = layout.y + maxLines * lineHeight;

    ctx.save();
    ctx.scale(K, K);
    setFont(20, true);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 3;
    ctx.fillStyle = '#FFFFFF';

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const lineY = bottom - (lines.length - index) * lineHeight;
      ctx.fillText(lines[index], px, lineY);
    }

    ctx.restore();

    let width = 1;
    setFont(20, true);
    for (const line of lines) {
      width = Math.max(width, tw(line, 20, true));
    }
    hudSetSize('LevelInfo', width, maxLines * lineHeight);
  }

  register({
    game: 'potatoepic',
    name: 'LevelInfo',
    desc: 'Display general information.',
    cat: 'Visual',
    nm: { l: 'levelinfo', ls: 'level info', n: 'LevelInfo', ns: 'Level Info' },
    disp: '',
    settings: [
      { t: 'b', n: 'Show FPS', d: 'Show the current FPS.', v: 1 },
      { t: 'b', n: 'Show Ping', d: 'Show the current ping.', v: 1 },
      { t: 'b', n: 'Show BPS', d: 'Show the current BPS.', v: 1 },
      { t: 'b', n: 'Show XYZ', d: 'Show the current XYZ coordinates.', v: 1 },
      { t: 'b', n: 'Show Seed', d: 'Show the current searcher seed.', v: 1 }
    ],
    renderOrder: 0,
    onRender: drawLevelInfo,
    defaultOn: false,
    onEnable() {}
  });
})();
