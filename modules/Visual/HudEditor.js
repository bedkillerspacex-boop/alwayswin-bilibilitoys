(() => {
  'use strict';

  const ELEMENTS = ['Watermark', 'Keystrokes', 'SpeedHUD'];
  let snap = 0;
  let drag = null;
  let wasDragging = false;

  function setEditorState(active) {
    if (S.hudEditor === active) {
      return;
    }

    S.hudEditor = active;

    if (active) {
      S.open = false;
      S.down = [false, false, false];
      S.clicked = [false, false, false];
    } else {
      drag = null;
      wasDragging = false;
    }

    document.dispatchEvent(new Event('solstice:hud-editor'));
  }

  function ensureElements() {
    if (!HUD_ELEMENTS.Watermark) {
      hudElement('Watermark', 20, 20, 200, 45);
    }

    if (!HUD_ELEMENTS.Keystrokes) {
      hudElement('Keystrokes', 100, 100, 140, 140);
    }

    if (!HUD_ELEMENTS.SpeedHUD) {
      hudElement('SpeedHUD', 20, 80, 145, 34);
    }
  }

  function drawBox(name, element, active) {
    const color = active ? themed(0) : [255, 255, 255];
    const alpha = active ? 0.9 : 0.55;

    ctx.strokeStyle = rgb(color, alpha);
    ctx.lineWidth = 1;
    ctx.strokeRect(element.x, element.y, element.w, element.h);

    setFont(14, false);
    ctx.fillStyle = rgb(color, alpha);
    ctx.fillText(name, element.x + 4, element.y + 4);
  }

  function draw(dt) {
    const module = getMod('HudEditor');
    const active = Boolean(module?.on);

    if (active !== S.hudEditor) {
      setEditorState(active);
    }

    if (!active) {
      return;
    }

    ensureElements();

    ctx.save();
    ctx.scale(K, K);
    const AW = W / K;
    const AH = H / K;
    const mx = S.mx / K;
    const my = S.my / K;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(0, 0, AW, AH);

    if (snap > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let x = 0; x <= AW; x += snap) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, AH);
      }

      for (let y = 0; y <= AH; y += snap) {
        ctx.moveTo(0, y);
        ctx.lineTo(AW, y);
      }

      ctx.stroke();
    }

    if (S.clicked[0] && !drag) {
      for (const name of ELEMENTS) {
        const element = HUD_ELEMENTS[name];

        if (
          element &&
          mx >= element.x &&
          mx <= element.x + element.w &&
          my >= element.y &&
          my <= element.y + element.h
        ) {
          drag = {
            name,
            dx: mx - element.x,
            dy: my - element.y
          };
          wasDragging = true;
          break;
        }
      }
    }

    if (drag && S.down[0]) {
      const element = HUD_ELEMENTS[drag.name];

      if (element) {
        let x = mx - drag.dx;
        let y = my - drag.dy;

        if (snap > 0) {
          x = Math.round(x / snap) * snap;
          y = Math.round(y / snap) * snap;
        }

        element.x = clamp(x, 0, Math.max(0, AW - element.w));
        element.y = clamp(y, 0, Math.max(0, AH - element.h));
        HUD_LAYOUT[drag.name] = { x: element.x, y: element.y };
      }
    } else if (drag && !S.down[0]) {
      drag = null;
    }

    if (!S.down[0] && wasDragging) {
      hudSave();
      wasDragging = false;
    }

    for (const name of ELEMENTS) {
      const element = HUD_ELEMENTS[name];

      if (element) {
        drawBox(name, element, drag?.name === name);
      }
    }

    setFont(18, true);
    ctx.textAlign = 'center';
    ctx.fillStyle = rgb([255, 255, 255], 0.9);
    ctx.fillText('HUD EDITOR', AW / 2, 24);

    setFont(13, false);
    ctx.fillStyle = rgb([255, 255, 255], 0.6);
    ctx.fillText(`Snap: ${snap}px  •  Drag elements  •  TAB snap  •  ESC exit`, AW / 2, 44);
    ctx.restore();
  }

  window.addEventListener('keydown', (event) => {
    if (!getMod('HudEditor')?.on) {
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.shiftKey) {
        snap = snap <= 0 ? 100 : snap - 5;
      } else {
        snap += 5;

        if (snap > 100) {
          snap = 0;
        }
      }

      return;
    }

    if (event.key === 'Insert') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setModuleOn(getMod('HudEditor'), false);
    }
  }, true);

  register({
    name: 'HudEditor',
    desc: 'Shows the hud editor on screen',
    cat: 'Visual',
    nm: { l: 'hudeditor', ls: 'hud editor', n: 'HudEditor', ns: 'Hud Editor' },
    disp: '',
    settings: [],
    renderOrder: 20,
    onRender: draw,
    onEnable() {}
  });
})();
