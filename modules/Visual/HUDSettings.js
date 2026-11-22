(() => {
  'use strict';

  const CHANNEL = 'solstice-hud-settings';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const MIN_SEND_INTERVAL_MS = 120;
  const HEARTBEAT_MS = 1000;

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
    const entry = module?.settings.find((item) => item.n === name);
    return entry ? entry.v : fallback;
  }

  function syncSettings() {
    const module = getMod('HUDSettings');

    if (!module) {
      return;
    }

    const active = Boolean(module.on);
    const maxFps = active ? Math.max(15, Math.min(144, Number(setting(module, 'Max Visual FPS', 60)) || 60)) : 144;
    const overlayFps = active ? Math.max(15, Math.min(144, Number(setting(module, 'Overlay FPS', 60)) || 60)) : 144;
    const maxDpr = active ? Math.max(0.75, Math.min(2, Number(setting(module, 'Max DPR', 1.5)) || 1.5)) : 2;
    const reduceBlur = active ? Boolean(setting(module, 'Reduce Blur', true)) : false;

    window.SolsticeHudSettings = {
      active,
      maxFps,
      overlayFps,
      maxDpr,
      reduceBlur
    };

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const payload = {
      channel: CHANNEL,
      type: 'config',
      active,
      overlayFps,
      maxDpr
    };
    const key = JSON.stringify(payload);

    if (key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const frame = findGameFrame();

    if (!frame?.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage(payload, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    name: 'HUDSettings',
    desc: 'Controls FPS cap, DPR scaling, and blur limits for all plugin visual elements.',
    cat: 'Visual',
    nm: { l: 'hudsettings', ls: 'hud settings', n: 'HUDSettings', ns: 'HUD Settings' },
    disp: 'Max Visual FPS',
    defaultOn: true,
    settings: [
      { t: 'n', n: 'Max Visual FPS', d: 'Max redraw rate for parent HUD elements when GUI is closed.', v: 60, min: 15, max: 144, step: 5 },
      { t: 'n', n: 'Overlay FPS', d: 'Max redraw rate for in-game ESP and NameTags overlays.', v: 60, min: 15, max: 144, step: 5 },
      { t: 'n', n: 'Max DPR', d: 'Cap canvas pixel ratio to reduce GPU fill-rate on high-DPI screens.', v: 1.5, min: 0.75, max: 2.0, step: 0.25 },
      { t: 'b', n: 'Reduce Blur', d: 'Skip heavy background blur filters while in-game.', v: 1 }
    ],
    onRender: syncSettings,
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncSettings();
    }
  });
})();
