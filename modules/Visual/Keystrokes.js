(() => {
  'use strict';

  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    playing: false
  };
  const anim = {
    w: 0,
    a: 0,
    s: 0,
    d: 0,
    space: 0
  };

  function isGameSource(source) {
    for (const frame of document.querySelectorAll('iframe')) {
      if (
        frame.src.startsWith(`${GAME_ORIGIN}/toy/golden-hour/`) &&
        frame.contentWindow === source
      ) {
        return true;
      }
    }

    return false;
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN || !isGameSource(event.source)) {
      return;
    }

    const data = event.data;

    if (!data || data.channel !== 'solstice-input' || data.type !== 'state') {
      return;
    }

    keys.w = Boolean(data.w);
    keys.a = Boolean(data.a);
    keys.s = Boolean(data.s);
    keys.d = Boolean(data.d);
    keys.space = Boolean(data.space);
    keys.playing = Boolean(data.playing);
  });

  function setting(name, fallback) {
    const module = getMod('Keystrokes');
    const value = module?.settings.find((entry) => entry.n === name);
    return value ? value.v : fallback;
  }

  function draw(dt) {
    if (!getMod('Keystrokes')?.on || !keys.playing) {
      return;
    }

    const useColor = Boolean(setting('Use Interface Color', true));
    const speed = Math.min(1, dt * 10);

    for (const key of Object.keys(anim)) {
      anim[key] += ((keys[key] ? 1 : 0) - anim[key]) * speed;
    }

    ctx.save();
    ctx.scale(K, K);
    const layout = hudElement('Keystrokes', 100, 100, 140, 140);
    hudApplyScale(layout);
    const x = layout.x;
    const y = layout.y;
    const size = 40;
    const pad = 5;
    const rounding = 8;

    function drawKey(keyX, keyY, keyW, keyH, label, pressed) {
      const amount = clamp(pressed, 0, 1);

      fillRR(keyX, keyY, keyW, keyH, rounding, [0, 0, 0], 150 / 255, CORNER_TOP | CORNER_BOTTOM);

      if (amount > 0.01) {
        const color = useColor ? themed(keyX + keyY * 5) : [255, 255, 255];
        const innerW = keyW * amount;
        const innerH = keyH * amount;

        fillRR(
          keyX + (keyW - innerW) / 2,
          keyY + (keyH - innerH) / 2,
          innerW,
          innerH,
          rounding * amount,
          color,
          (200 / 255) * amount,
          CORNER_TOP | CORNER_BOTTOM
        );
      }

      if (!label) {
        return;
      }

      ctx.save();
      setFont(20, true);
      const metrics = ctx.measureText(label);
      const textHeight = Math.max(
        20,
        Math.ceil((metrics.actualBoundingBoxAscent || 20) + (metrics.actualBoundingBoxDescent || 0))
      );
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = rgb([255, 255, 255], 1);
      ctx.fillText(label, keyX + keyW / 2, keyY + keyH / 2 - textHeight / 2);
      ctx.restore();
    }

    drawKey(x + 50, y + pad, size, size, 'W', anim.w);
    drawKey(x + 5, y + size + pad * 2, size, size, 'A', anim.a);
    drawKey(x + 50, y + size + pad * 2, size, size, 'S', anim.s);
    drawKey(x + 95, y + size + pad * 2, size, size, 'D', anim.d);
    drawKey(x + 5, y + size * 2 + pad * 3, 130, size, '', anim.space);

    ctx.restore();
  }

  register({
    name: 'Keystrokes',
    desc: 'Shows keystrokes on screen',
    cat: 'Visual',
    nm: { l: 'keystrokes', ls: 'keystrokes', n: 'Keystrokes', ns: 'Keystrokes' },
    disp: '',
    settings: [
      { t: 'b', n: 'Use Interface Color', d: 'Whether or not to use the interface color', v: 1 }
    ],
    renderOrder: 0,
    onRender: draw,
    onEnable() {}
  });
})();
