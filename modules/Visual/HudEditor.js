(() => {
  'use strict';

  const ELEMENTS = ['Watermark', 'Keystrokes', 'SpeedHUD', 'Promo', 'Indicators', 'Arraylist', 'TargetHUD', 'SessionStats'];
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

    if (!HUD_ELEMENTS.Indicators) {
      hudElement('Indicators', 20, 124, 205, 58);
    }

    if (!HUD_ELEMENTS.Arraylist) {
      hudElement('Arraylist', Math.max(0, (W / K) - 220), 5, 210, 120);
    }

    if (!HUD_ELEMENTS.TargetHUD) {
      hudElement('TargetHUD', Math.round((W / K) * 0.5 + 32), Math.round((H / K) * 0.5 - 33), 220, 66);
    }

    if (!HUD_ELEMENTS.SessionStats) {
      hudElement('SessionStats', 20, 210, 205, 74);
    }

    if (!HUD_ELEMENTS.Promo) {
      hudElement('Promo', Math.max(16, (W / K) - 180), Math.max(16, (H / K) - 54), 160, 34);
    }
  }

  function elementScale(element) {
    return element && Number.isFinite(element.scale) && element.scale > 0 ? element.scale : 1;
  }

  function drawBox(name, element, active) {
    const color = active ? themed(0) : [255, 255, 255];
    const alpha = active ? 0.9 : 0.55;
    const sc = elementScale(element);
    const sw = element.w * sc;
    const sh = element.h * sc;

    ctx.strokeStyle = rgb(color, alpha);
    ctx.lineWidth = 1;
    ctx.strokeRect(element.x, element.y, sw, sh);

    // Bottom-left resize handle
    const handleSize = 8;
    ctx.fillStyle = rgb(color, active ? 0.95 : 0.75);
    ctx.fillRect(element.x, element.y + sh - handleSize, handleSize, handleSize);

    setFont(14, false);
    ctx.fillStyle = rgb(color, alpha);
    const label = sc !== 1 ? `${name} (${sc.toFixed(2)}x)` : name;
    ctx.fillText(label, element.x + 4, element.y + 4);
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

        if (!element) {
          continue;
        }

        const sc = elementScale(element);
        const sw = element.w * sc;
        const sh = element.h * sc;
        const handleHit = 14;

        if (
          mx >= element.x - 4 &&
          mx <= element.x + handleHit &&
          my >= element.y + sh - handleHit &&
          my <= element.y + sh + 4
        ) {
          drag = {
            name,
            mode: 'resize',
            anchorRight: element.x + sw,
            anchorTop: element.y,
            baseW: Math.max(20, element.w),
            baseH: Math.max(16, element.h)
          };
          wasDragging = true;
          break;
        }

        if (
          mx >= element.x &&
          mx <= element.x + sw &&
          my >= element.y &&
          my <= element.y + sh
        ) {
          drag = {
            name,
            mode: 'move',
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
        const sc = elementScale(element);

        if (drag.mode === 'resize') {
          const reqW = drag.anchorRight - mx;
          const reqH = my - drag.anchorTop;
          const nextScale = clamp(Math.max(reqW / drag.baseW, reqH / drag.baseH), 0.4, 3.0);
          const nextW = drag.baseW * nextScale;
          element.scale = Math.round(nextScale * 100) / 100;
          element.x = clamp(drag.anchorRight - nextW, 0, Math.max(0, AW - nextW));
          HUD_LAYOUT[drag.name] = { x: element.x, y: element.y, scale: element.scale };
        } else {
          let x = mx - drag.dx;
          let y = my - drag.dy;

          if (snap > 0) {
            x = Math.round(x / snap) * snap;
            y = Math.round(y / snap) * snap;
          }

          element.x = clamp(x, 0, Math.max(0, AW - element.w * sc));
          element.y = clamp(y, 0, Math.max(0, AH - element.h * sc));
          HUD_LAYOUT[drag.name] = { x: element.x, y: element.y, scale: sc };
        }
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
