(() => {
  'use strict';

  const CHANNEL = 'solstice-input';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';

  const telemetry = {
    playing: false,
    slideCooldown: 0,
    sliding: false,
    auraTarget: null,
    meleeReady: false
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN) {
      return;
    }

    const data = event.data;

    if (!data || typeof data !== 'object' || data.channel !== CHANNEL || data.type !== 'state') {
      return;
    }

    telemetry.playing = Boolean(data.playing);
    telemetry.slideCooldown = Math.max(0, Number(data.slideCooldown) || 0);
    telemetry.sliding = Boolean(data.sliding);
    telemetry.auraTarget = data.auraTarget && typeof data.auraTarget === 'object' ? data.auraTarget : null;
    telemetry.meleeReady = Boolean(data.meleeReady);
  });

  function setting(module, name, fallback) {
    const entry = module?.settings.find((item) => item.n === name);
    return entry ? entry.v : fallback;
  }

  function draw() {
    const module = getMod('Indicators');

    if (!module?.on || (!telemetry.playing && !S.hudEditor)) {
      return;
    }

    const showTarget = Boolean(setting(module, 'Target Info', true));
    const showSlide = Boolean(setting(module, 'Slide Bar', true));
    const useColor = Boolean(setting(module, 'Use Interface Color', true));
    const showBg = Boolean(setting(module, 'Background', true));

    const target = telemetry.auraTarget || (S.hudEditor ? { name: 'Target', health: 80, distance: 12.4, backtrackMs: 95 } : null);
    const hasTargetRow = showTarget && Boolean(target);
    const hasSlideRow = showSlide;

    if (!hasTargetRow && !hasSlideRow && !telemetry.meleeReady) {
      return;
    }

    const width = 205;
    const height = (hasTargetRow ? 26 : 0) + (hasSlideRow ? 22 : 0) + (telemetry.meleeReady ? 18 : 0) + 10;

    ctx.save();
    ctx.scale(K, K);

    const layout = hudElement('Indicators', 20, 124, width, height);
    layout.w = width;
    layout.h = height;

    const accent = useColor ? themed(layout.x + layout.y * 2) : [255, 255, 255];

    if (showBg) {
      fillRR(layout.x, layout.y, layout.w, layout.h, 8, [0, 0, 0], 155 / 255, CORNER_TOP | CORNER_BOTTOM);
      fillRR(layout.x, layout.y + 6, 3, layout.h - 12, 2, accent, 0.95, CORNER_TOP | CORNER_BOTTOM);
    }

    let cy = layout.y + 6;
    const tx = layout.x + 11;

    if (hasTargetRow && target) {
      ctx.save();
      setFont(13, true);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const btTag = target.backtrackMs > 0 ? ` [BT -${target.backtrackMs}ms]` : '';
      const line = `${target.name}  ${target.health}HP  ${target.distance}m${btTag}`;
      ctx.fillStyle = target.backtrackMs > 0 ? 'rgba(0, 245, 255, 0.95)' : rgb([255, 255, 255], 1);
      ctx.fillText(line, tx, cy);
      cy += 17;

      const barW = layout.w - 20;
      const hpRatio = Math.max(0, Math.min(1, Number(target.health) / 100));
      fillRR(tx, cy, barW, 4, 2, [45, 45, 55], 0.85, CORNER_TOP | CORNER_BOTTOM);
      const hpColor = target.health > 60 ? [74, 222, 128] : target.health > 30 ? [250, 204, 21] : [239, 68, 68];
      fillRR(tx, cy, barW * hpRatio, 4, 2, hpColor, 0.95, CORNER_TOP | CORNER_BOTTOM);
      ctx.restore();
      cy += 9;
    }

    if (hasSlideRow) {
      ctx.save();
      setFont(12, true);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const cd = telemetry.slideCooldown;
      const slideLabel = telemetry.sliding
        ? 'Slide: SLIDING'
        : cd <= 0.01
          ? 'Slide: READY'
          : `Slide: ${cd.toFixed(2)}s`;
      const slideColor = telemetry.sliding
        ? [167, 139, 250]
        : cd <= 0.01
          ? [74, 222, 128]
          : [250, 204, 21];
      ctx.fillStyle = rgb(slideColor, 1);
      ctx.fillText(slideLabel, tx, cy);

      const barW = layout.w - 20;
      const readyRatio = telemetry.sliding ? 1 : Math.max(0, Math.min(1, 1 - cd / 0.4));
      fillRR(tx, cy + 14, barW, 3.5, 2, [45, 45, 55], 0.85, CORNER_TOP | CORNER_BOTTOM);
      fillRR(tx, cy + 14, barW * readyRatio, 3.5, 2, slideColor, 0.95, CORNER_TOP | CORNER_BOTTOM);
      ctx.restore();
      cy += 22;
    }

    if (telemetry.meleeReady) {
      ctx.save();
      setFont(12, true);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(248, 113, 113, 1)';
      ctx.fillText('MELEE IN RANGE', tx, cy);
      ctx.restore();
    }

    ctx.restore();
  }

  register({
    name: 'Indicators',
    desc: 'Displays Aura target, Backtrack state, Slide readiness, and Melee alerts (draggable in HudEditor).',
    cat: 'Visual',
    nm: { l: 'indicators', ls: 'indicators', n: 'Indicators', ns: 'Indicators' },
    disp: '',
    settings: [
      { t: 'b', n: 'Target Info', d: 'Show Aura locked target name, HP, distance, and Backtrack ms.', v: 1 },
      { t: 'b', n: 'Slide Bar', d: 'Show server Slide Boost readiness and cooldown bar.', v: 1 },
      { t: 'b', n: 'Use Interface Color', d: 'Tint accent bar with interface theme color.', v: 1 },
      { t: 'b', n: 'Background', d: 'Draw dark rounded background behind indicators.', v: 1 }
    ],
    onRender: draw,
    renderOrder: 22,
    onEnable() {}
  });
})();
