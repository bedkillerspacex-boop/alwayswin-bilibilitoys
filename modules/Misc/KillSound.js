(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-misc';
  const KILL_CHANNEL = 'solstice-kill';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;
  const SOUNDS = {
    Cash: 'cash.wav',
    Fard: 'fard.wav',
    Mario: 'mariodeath.wav',
    Windows: 'windows_background.wav'
  };

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

  function setting(name, fallback) {
    const module = getMod('KillSound');
    const value = module?.settings.find((entry) => entry.n === name);
    return value ? value.v : fallback;
  }

  function syncConfig() {
    const module = getMod('KillSound');

    if (!module) {
      return;
    }

    const now = performance.now();
    const modeSetting = module.settings.find((entry) => entry.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] || 'Cash';
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'killsound',
      enabled: Boolean(module.on),
      mode,
      volume: Math.max(0, Math.min(1, Number(setting('Volume', 1)) || 0))
    };
    const key = JSON.stringify(config);

    if (key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const frame = findGameFrame();

    if (!frame?.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage(config, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN || event.data?.channel !== KILL_CHANNEL || event.data.type !== 'kill') {
      return;
    }

    const frame = findGameFrame();

    if (!frame || event.source !== frame.contentWindow) {
      return;
    }

    const module = getMod('KillSound');

    if (!module?.on) {
      return;
    }

    const modeSetting = module.settings.find((entry) => entry.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] || 'Cash';
    const file = SOUNDS[mode];

    if (!file) {
      return;
    }

    const base = document.documentElement?.getAttribute('data-solstice-audio-base');

    if (!base) {
      return;
    }

    const volume = Number(setting('Volume', 1));
    const audio = new Audio(`${base}${file}`);

    audio.volume = clamp(Number.isFinite(volume) ? volume : 1, 0, 1);
    audio.play().catch(() => {});
  });

  register({
    name: 'KillSound',
    desc: 'Plays a sound when you kill an enemy.',
    cat: 'Misc',
    nm: { l: 'killsound', ls: 'kill sound', n: 'KillSound', ns: 'Kill Sound' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'The kill sound.', v: 0, vals: ['Cash', 'Fard', 'Mario', 'Windows'] },
      { t: 'n', n: 'Volume', d: 'The volume of the kill sound.', v: 1, min: 0, max: 1, step: 0.1 }
    ],
    onRender: syncConfig,
    onEnable() {
      syncConfig();
    }
  });

  setInterval(syncConfig, 250);

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

    function sendKill() {
      try {
        window.parent.postMessage({
          channel: 'solstice-kill',
          type: 'kill'
        }, 'https://www.bilibili.com');
      } catch {

      }
    }

    function installHook() {
      const debug = window.GH?.debug;
      const hud = debug?.ctx?.hud || debug?.hud;
      const callback = hud?.cb;

      if (!callback || typeof callback.hitSound !== 'function' || callback.hitSound.__solsticeKillSound) {
        return;
      }

      const originalSound = callback.hitSound;

      callback.hitSound = function killSoundHit(type, ...args) {
        if (enabled && type === 'kill') {
          sendKill();
          return;
        }

        return originalSound.call(this, type, ...args);
      };
      callback.hitSound.__solsticeKillSound = true;
    }

    bridge.onConfig('solstice-misc', (data) => {
      if (data.type !== 'config' || data.module !== 'killsound') {
        return;
      }

      enabled = Boolean(data.enabled);
    });

    setInterval(installHook, 500);
    installHook();
  }
})();
