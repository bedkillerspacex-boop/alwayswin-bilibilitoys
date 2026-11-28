(() => {
  'use strict';

  const CHANNEL = 'solstice-devicespoof';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;
  let lastSentAt = 0;

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/potatoepic/')) {
    bootGame();
    return;
  }

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(GAME_ORIGIN + '/toy/potatoepic/')) {
        return frame;
      }
    }

    return null;
  }

  function syncConfig(force = false) {
    const module = getMod('DeviceSpoof');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (!force && now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const modeSetting = module.settings.find((setting) => setting.n === 'Mode');
    const mode = Math.max(0, Math.min(1, Math.round(Number(modeSetting?.v) || 0)));
    const frame = findGameFrame();

    if (!frame?.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage({
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(module.on),
      mode
    }, GAME_ORIGIN);
    lastSentAt = now;
  }

  register({
    name: 'DeviceSpoof',
    desc: 'Spoofs all ur ids',
    cat: 'Misc',
    nm: { l: 'devicespoof', ls: 'device spoof', n: 'DeviceSpoof', ns: 'Device Spoof' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'The device mode to spoof.', v: 0, vals: ['Touch', 'Mouse'] }
    ],
    onRender: () => syncConfig(false),
    defaultOn: false,
    onEnable() {
      lastSentAt = 0;
      syncConfig(true);
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
    let mode = 0;
    let hookedDevKind = null;

    function installHook() {
      const xz = window.XZ;

      if (!xz || typeof xz.devKind !== 'function') {
        return;
      }

      if (xz.devKind === hookedDevKind) {
        return;
      }

      const original = xz.devKind;

      if (original.__solsticeDeviceSpoof) {
        hookedDevKind = original;
        return;
      }

      const wrapped = function deviceSpoofDevKind(game) {
        if (enabled) {
          return mode === 0 ? 'touch' : 'mouse';
        }

        return original.call(this, game);
      };

      Object.defineProperty(wrapped, '__solsticeDeviceSpoof', { value: true });

      try {
        xz.devKind = wrapped;
        hookedDevKind = wrapped;
      } catch {

      }
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }

      enabled = Boolean(data.enabled);
      mode = Math.max(0, Math.min(1, Math.round(Number(data.mode) || 0)));
      installHook();
    });

    installHook();
    setInterval(installHook, 500);
  }
})();
