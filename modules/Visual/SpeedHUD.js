(() => {
  'use strict';

  const CHANNEL = 'solstice-input';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const AVG_WINDOW_MS = 1500;

  const telemetry = {
    playing: false,
    speed: 0,
    serverSpeed: 0,
    avgSpeed: 0,
    avgServerSpeed: 0
  };
  const samples = [];

  function recordSample(speed, serverSpeed) {
    const now = performance.now();
    samples.push({ t: now, speed, serverSpeed });

    while (samples.length > 0 && now - samples[0].t > AVG_WINDOW_MS) {
      samples.shift();
    }

    if (samples.length === 0) {
      telemetry.avgSpeed = speed;
      telemetry.avgServerSpeed = serverSpeed;
      return;
    }

    let sumLocal = 0;
    let sumServer = 0;

    for (const s of samples) {
      sumLocal += s.speed;
      sumServer += s.serverSpeed;
    }

    telemetry.avgSpeed = sumLocal / samples.length;
    telemetry.avgServerSpeed = sumServer / samples.length;
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN) {
      return;
    }

    const data = event.data;

    if (!data || typeof data !== 'object' || data.channel !== CHANNEL || data.type !== 'state') {
      return;
    }

    telemetry.playing = Boolean(data.playing);
    telemetry.speed = Number.isFinite(Number(data.speed)) ? Number(data.speed) : 0;
    telemetry.serverSpeed = Number.isFinite(Number(data.serverSpeed)) ? Number(data.serverSpeed) : 0;

    if (telemetry.playing) {
      recordSample(telemetry.speed, telemetry.serverSpeed);
    } else {
      samples.length = 0;
      telemetry.avgSpeed = 0;
      telemetry.avgServerSpeed = 0;
    }
  });

  function setting(module, name, fallback) {
    const entry = module?.settings.find((item) => item.n === name);
    return entry ? entry.v : fallback;
  }

  function draw() {
    const module = getMod('SpeedHUD');

    if (!module?.on || (!telemetry.playing && !S.hudEditor)) {
      return;
    }

    const sourceSetting = module.settings.find((item) => item.n === 'Source');
    const source = sourceSetting?.vals?.[sourceSetting.v] || 'Both';
    const showAvg = Boolean(setting(module, 'Show Avg (1.5s)', true));
    const useColor = Boolean(setting(module, 'Use Interface Color', true));
    const showBg = Boolean(setting(module, 'Background', true));

    let label = '';

    if (source === 'Local') {
      label = showAvg
        ? `Speed: ${telemetry.speed.toFixed(2)} m/s  |  Avg: ${telemetry.avgSpeed.toFixed(2)}`
        : `Speed: ${telemetry.speed.toFixed(2)} m/s`;
    } else if (source === 'Server') {
      label = showAvg
        ? `Server: ${telemetry.serverSpeed.toFixed(2)} m/s  |  Avg: ${telemetry.avgServerSpeed.toFixed(2)}`
        : `Server: ${telemetry.serverSpeed.toFixed(2)} m/s`;
    } else {
      label = showAvg
        ? `Speed: ${telemetry.speed.toFixed(2)} / ${telemetry.serverSpeed.toFixed(2)} m/s  |  Avg: ${telemetry.avgSpeed.toFixed(2)} / ${telemetry.avgServerSpeed.toFixed(2)}`
        : `Speed: ${telemetry.speed.toFixed(2)} / ${telemetry.serverSpeed.toFixed(2)} m/s`;
    }

    ctx.save();
    ctx.scale(K, K);

    setFont(15, true);
    const measuredW = Math.ceil(ctx.measureText(label).width) + 22;
    const width = Math.max(135, measuredW);
    const height = 34;
    const layout = hudElement('SpeedHUD', 20, 80, width, height);
    layout.w = width;
    layout.h = height;

    const accent = useColor ? themed(layout.x + layout.y * 3) : [255, 255, 255];

    if (showBg) {
      fillRR(layout.x, layout.y, layout.w, layout.h, 8, [0, 0, 0], 155 / 255, CORNER_TOP | CORNER_BOTTOM);
      fillRR(layout.x, layout.y + 6, 3, layout.h - 12, 2, accent, 0.95, CORNER_TOP | CORNER_BOTTOM);
    }

    ctx.save();
    setFont(15, true);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgb([255, 255, 255], 1);
    ctx.fillText(label, layout.x + 11, layout.y + layout.h / 2 + 0.5);
    ctx.restore();

    ctx.restore();
  }

  register({
    name: 'SpeedHUD',
    desc: 'Displays current horizontal movement speed (draggable in HudEditor).',
    cat: 'Visual',
    nm: { l: 'speedhud', ls: 'speed hud', n: 'SpeedHUD', ns: 'Speed HUD' },
    disp: 'Source',
    settings: [
      { t: 'e', n: 'Source', d: 'Which speed value to display.', v: 0, vals: ['Both', 'Local', 'Server'] },
      { t: 'b', n: 'Show Avg (1.5s)', d: 'Show rolling 1.5s average speed.', v: 1 },
      { t: 'b', n: 'Use Interface Color', d: 'Tint accent bar with interface theme color.', v: 1 },
      { t: 'b', n: 'Background', d: 'Draw dark rounded background behind speed text.', v: 1 }
    ],
    onRender: draw,
    renderOrder: 20,
    onEnable() {}
  });
})();
