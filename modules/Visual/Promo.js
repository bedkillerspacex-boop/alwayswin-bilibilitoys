(() => {
  'use strict';

  const PROMO_TEXT = '获取进群817198355';

  function setting(module, name, fallback) {
    const entry = module?.settings.find((item) => item.n === name);
    return entry ? entry.v : fallback;
  }

  function draw() {
    const module = getMod('Promo');

    if (!module?.on) {
      return;
    }

    const useColor = Boolean(setting(module, 'Use Interface Color', true));
    const showBg = Boolean(setting(module, 'Background', true));

    ctx.save();
    ctx.scale(K, K);

    setFont(15, true);
    const aw = W / K;
    const ah = H / K;
    const measuredW = Math.ceil(ctx.measureText(PROMO_TEXT).width) + 22;
    const width = Math.max(150, measuredW);
    const height = 34;
    const defX = Math.max(16, aw - width - 20);
    const defY = Math.max(16, ah - height - 20);
    const layout = hudElement('Promo', defX, defY, width, height);
    layout.w = width;
    layout.h = height;
    hudApplyScale(layout);

    const accent = useColor ? themed(layout.x + layout.y * 3) : [255, 255, 255];

    if (showBg) {
      fillRR(layout.x, layout.y, layout.w, layout.h, 8, [0, 0, 0], 155 / 255, CORNER_TOP | CORNER_BOTTOM);
      fillRR(layout.x, layout.y + 6, 3, layout.h - 12, 2, accent, 0.95, CORNER_TOP | CORNER_BOTTOM);
    }

    setFont(15, true);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgb([255, 255, 255], 1);
    ctx.fillText(PROMO_TEXT, layout.x + 11, layout.y + layout.h / 2 + 0.5);
    ctx.restore();

    ctx.restore();
  }

  register({
    name: 'Promo',
    desc: 'Displays promo text in the bottom-right corner (draggable in HudEditor).',
    cat: 'Visual',
    nm: { l: 'promo', ls: 'promo', n: 'Promo', ns: 'Promo' },
    disp: '',
    settings: [
      { t: 'b', n: 'Use Interface Color', d: 'Tint accent bar with interface theme color.', v: 1 },
      { t: 'b', n: 'Background', d: 'Draw dark rounded background behind promo text.', v: 1 }
    ],
    onRender: draw,
    renderOrder: 22,
    onEnable() {}
  });
})();
