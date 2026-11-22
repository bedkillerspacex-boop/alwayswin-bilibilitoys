(() => {
  'use strict';

  const GUI_POS_KEY = 'solstice.mobile.guiPos';
  const FS_POS_KEY = 'solstice.mobile.fsPos';
  const SHORTCUTS_KEY = 'solstice.mobile.shortcuts';

  function isMobileDevice() {
    if (typeof S !== 'undefined' && S.isMobile) {
      return true;
    }

    return (
      (typeof navigator !== 'undefined' &&
        navigator.maxTouchPoints > 0 &&
        typeof matchMedia === 'function' &&
        matchMedia('(pointer: coarse)').matches) ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')
    );
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {

    }
  }

  let shortcuts = Array.isArray(readJson(SHORTCUTS_KEY, [])) ? readJson(SHORTCUTS_KEY, []) : [];
  const buttonMap = new Map();
  let layer = null;

  function saveShortcuts() {
    writeJson(SHORTCUTS_KEY, shortcuts);
  }

  function hasShortcut(name) {
    return shortcuts.some((item) => item && item.name === name);
  }

  function clampPos(x, y, el) {
    const w = el?.offsetWidth || 72;
    const h = el?.offsetHeight || 32;
    return {
      x: Math.max(6, Math.min(Math.max(6, window.innerWidth - w - 6), x)),
      y: Math.max(6, Math.min(Math.max(6, window.innerHeight - h - 6), y))
    };
  }

  function makeDraggableButton({ text, initialX, initialY, onTap, onMoveEnd, isGui }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.cssText = [
      'position: fixed',
      'left: 0',
      'top: 0',
      'min-width: 56px',
      'height: 32px',
      'padding: 0 11px',
      'border-radius: 999px',
      isGui
        ? 'border: 1px solid rgba(167, 139, 250, 0.85)'
        : 'border: 1px solid rgba(255, 255, 255, 0.22)',
      isGui
        ? 'background: rgba(24, 18, 42, 0.90)'
        : 'background: rgba(16, 18, 26, 0.86)',
      'color: #f3f4f6',
      'font: 600 12px/32px system-ui, -apple-system, sans-serif',
      'letter-spacing: 0.2px',
      'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.32)',
      'pointer-events: auto',
      'touch-action: none',
      'user-select: none',
      '-webkit-user-select: none',
      'cursor: pointer',
      'transition: background 120ms ease, border-color 120ms ease, color 120ms ease'
    ].join(';');

    let posX = initialX;
    let posY = initialY;

    function applyPos(x, y) {
      const clamped = clampPos(x, y, btn);
      posX = clamped.x;
      posY = clamped.y;
      btn.style.transform = `translate3d(${Math.round(posX)}px, ${Math.round(posY)}px, 0)`;
    }

    let drag = null;

    btn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      drag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origX: posX,
        origY: posY,
        moved: false
      };
      try {
        btn.setPointerCapture(event.pointerId);
      } catch {

      }
    });

    btn.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) {
        return;
      }

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (!drag.moved && Math.hypot(dx, dy) > 7) {
        drag.moved = true;
      }

      if (drag.moved) {
        applyPos(drag.origX + dx, drag.origY + dy);
      }
    });

    function finishDrag(event) {
      if (!drag || event.pointerId !== drag.id) {
        return;
      }

      const moved = drag.moved;
      drag = null;

      if (moved) {
        onMoveEnd?.(posX, posY);
      } else if (event.type === 'pointerup') {
        onTap?.();
      }
    }

    btn.addEventListener('pointerup', finishDrag);
    btn.addEventListener('pointercancel', finishDrag);

    layer.appendChild(btn);
    applyPos(posX, posY);
    return { btn, applyPos };
  }

  function renderShortcuts() {
    if (!layer) {
      return;
    }

    const wanted = new Set(shortcuts.map((item) => item.name));

    for (const [name, entry] of buttonMap) {
      if (!wanted.has(name)) {
        entry.btn.remove();
        buttonMap.delete(name);
      }
    }

    for (const item of shortcuts) {
      if (!item?.name || buttonMap.has(item.name)) {
        continue;
      }

      const created = makeDraggableButton({
        text: item.name,
        initialX: Number.isFinite(item.x) ? item.x : 14,
        initialY: Number.isFinite(item.y) ? item.y : 64,
        isGui: false,
        onTap: () => {
          const mod = typeof getMod === 'function' ? getMod(item.name) : null;

          if (!mod) {
            return;
          }

          if (mod.name === 'ClickGui') {
            document.dispatchEvent(new CustomEvent('solstice:ui:toggle'));
          } else if (typeof setModuleOn === 'function') {
            setModuleOn(mod, !mod.on);
          }

          syncShortcutStyles();
        },
        onMoveEnd: (x, y) => {
          item.x = x;
          item.y = y;
          saveShortcuts();
        }
      });

      buttonMap.set(item.name, created);
    }

    syncShortcutStyles();
  }

  function syncShortcutStyles() {
    for (const [name, entry] of buttonMap) {
      const mod = typeof getMod === 'function' ? getMod(name) : null;
      const active = Boolean(mod?.on);
      entry.btn.style.background = active ? 'rgba(109, 40, 217, 0.86)' : 'rgba(16, 18, 26, 0.78)';
      entry.btn.style.borderColor = active ? 'rgba(196, 181, 253, 0.95)' : 'rgba(255, 255, 255, 0.22)';
      entry.btn.style.color = active ? '#ffffff' : '#d1d5db';
    }
  }

  function toggleShortcut(mod) {
    if (!mod?.name) {
      return false;
    }

    const idx = shortcuts.findIndex((item) => item && item.name === mod.name);

    if (idx >= 0) {
      shortcuts.splice(idx, 1);
      saveShortcuts();
      renderShortcuts();
      return false;
    }

    const index = shortcuts.length;
    const x = 14 + (index % 3) * 86;
    const y = 64 + Math.floor(index / 3) * 40;
    shortcuts.push({ name: mod.name, x, y });
    saveShortcuts();
    renderShortcuts();
    return true;
  }

  function initMobileUI() {
    if (!isMobileDevice() || layer) {
      return;
    }

    const parent = document.documentElement || document.body;

    if (!parent) {
      setTimeout(initMobileUI, 50);
      return;
    }

    layer = document.createElement('div');
    layer.id = 'solstice-mobile-controls';
    layer.style.cssText = [
      'position: fixed',
      'inset: 0',
      'pointer-events: none',
      'z-index: 2147483647'
    ].join(';');
    parent.appendChild(layer);

    const savedGui = readJson(GUI_POS_KEY, null);
    const defaultX = Math.max(12, window.innerWidth - 76);
    const defaultY = 14;

    const guiBtn = makeDraggableButton({
      text: 'GUI',
      initialX: Number.isFinite(savedGui?.x) ? savedGui.x : defaultX,
      initialY: Number.isFinite(savedGui?.y) ? savedGui.y : defaultY,
      isGui: true,
      onTap: () => {
        document.dispatchEvent(new CustomEvent('solstice:ui:toggle'));
      },
      onMoveEnd: (x, y) => {
        writeJson(GUI_POS_KEY, { x, y });
      }
    });

    function isFullscreen() {
      return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    }

    function toggleFullscreen() {
      const target = document.documentElement || document.body;

      if (!isFullscreen()) {
        const req = target.requestFullscreen || target.webkitRequestFullscreen;

        if (typeof req === 'function') {
          try {
            const p = req.call(target, { navigationUI: 'hide' });
            if (p && typeof p.catch === 'function') {
              p.catch(() => {
                try {
                  req.call(target);
                } catch {

                }
              });
            }
          } catch {
            try {
              req.call(target);
            } catch {

            }
          }
        }
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;

        if (typeof exit === 'function') {
          try {
            exit.call(document);
          } catch {

          }
        }
      }
    }

    const savedFs = readJson(FS_POS_KEY, null);
    const defaultFsX = Math.max(12, window.innerWidth - 142);

    const fsBtn = makeDraggableButton({
      text: 'FS',
      initialX: Number.isFinite(savedFs?.x) ? savedFs.x : defaultFsX,
      initialY: Number.isFinite(savedFs?.y) ? savedFs.y : defaultY,
      isGui: true,
      onTap: () => {
        toggleFullscreen();
      },
      onMoveEnd: (x, y) => {
        writeJson(FS_POS_KEY, { x, y });
      }
    });

    function syncFsStyle() {
      const active = isFullscreen();
      fsBtn.btn.style.background = active ? 'rgba(109, 40, 217, 0.86)' : 'rgba(24, 18, 42, 0.84)';
      fsBtn.btn.style.borderColor = active ? 'rgba(196, 181, 253, 0.95)' : 'rgba(167, 139, 250, 0.85)';
      fsBtn.btn.textContent = active ? 'EXIT FS' : 'FS';
    }

    document.addEventListener('fullscreenchange', syncFsStyle);
    document.addEventListener('webkitfullscreenchange', syncFsStyle);
    syncFsStyle();

    window.addEventListener('resize', () => {
      guiBtn.applyPos(
        Number.isFinite(readJson(GUI_POS_KEY, null)?.x) ? readJson(GUI_POS_KEY, null).x : window.innerWidth - 76,
        Number.isFinite(readJson(GUI_POS_KEY, null)?.y) ? readJson(GUI_POS_KEY, null).y : 14
      );
      fsBtn.applyPos(
        Number.isFinite(readJson(FS_POS_KEY, null)?.x) ? readJson(FS_POS_KEY, null).x : Math.max(12, window.innerWidth - 142),
        Number.isFinite(readJson(FS_POS_KEY, null)?.y) ? readJson(FS_POS_KEY, null).y : 14
      );
      for (const item of shortcuts) {
        const entry = buttonMap.get(item.name);
        if (entry) {
          entry.applyPos(item.x, item.y);
        }
      }
    });

    renderShortcuts();
    setInterval(syncShortcutStyles, 150);
  }

  window.SolsticeMobile = {
    isMobile: isMobileDevice,
    hasShortcut,
    toggleShortcut
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileUI, { once: true });
  } else {
    initMobileUI();
  }
})();
