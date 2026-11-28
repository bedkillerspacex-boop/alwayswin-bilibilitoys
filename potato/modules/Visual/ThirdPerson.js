(() => {
  'use strict';

  const CHANNEL = 'solstice-visual';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 400;

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/potatoepic/')) {
    bootGame();
    return;
  }

  let lastSentKey = '';
  let lastSentAt = 0;

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}/toy/potatoepic/`)) {
        return frame;
      }
    }
    return null;
  }

  function syncConfig() {
    const module = getMod('ThirdPerson');
    if (!module) return;

    const modeSetting = module.settings.find((s) => s.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] || 'Shoulder';
    const disableOutsideMatch = Boolean(module.settings.find((s) => s.n === 'Disable Outside Match')?.v);
    module.disp = mode;

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'thirdperson',
      enabled: Boolean(module.on),
      mode,
      disableOutsideMatch
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

  register({
    game: 'potatoepic',
    name: 'ThirdPerson',
    desc: 'Uses PotatoEpic native third-person camera (Shoulder, Back, or Front) during matches.',
    cat: 'Visual',
    nm: { l: 'thirdperson', ls: 'third person', n: 'ThirdPerson', ns: 'Third Person' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'Shoulder = native over-the-shoulder; Back = 3rd-person back; Front = 3rd-person front.', v: 0, vals: ['Shoulder', 'Back', 'Front'] },
      { t: 'b', n: 'Disable Outside Match', d: 'Disable third-person outside active matches.', v: 0 }
    ],
    renderOrder: 3,
    onRender: syncConfig,
    defaultOn: false,
    onEnable() {
      lastSentAt = 0;
      syncConfig();
    }
  });

  function bootGame() {
    let attempts = 0;

    function start() {
      const bridge = window.SolsticeGame;
      if (!bridge) {
        if (attempts++ < 120) {
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
    let mode = 'Shoulder';
    let disableOutsideMatch = false;
    let applied = false;

    function isInMatch(game) {
      const xzeR = window.XZE?.R;
      return Boolean(
        game &&
        game.state === 'play' &&
        !game.ui?.screen &&
        game.player &&
        (!xzeR || xzeR.st === 'play')
      );
    }

    function applyNativeState() {
      const game = window.game;
      if (!game) return;

      const canApply = disableOutsideMatch
        ? isInMatch(game)
        : Boolean(game.player && game.state === 'play');

      if (enabled && canApply) {
        applied = true;
        if (mode === 'Shoulder') {
          game.potTP = 0;
          game.potView = 1;
        } else if (mode === 'Front') {
          game.potView = 0;
          game.potTP = 2;
        } else {
          game.potView = 0;
          game.potTP = 1;
        }
      } else if (applied) {
        applied = false;
        game.potTP = 0;
        game.potView = 0;
        game.perspective = 0;
        game.potPersp = 0;
      }
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'thirdperson') {
        return;
      }
      enabled = Boolean(data.enabled);
      mode = ['Shoulder', 'Back', 'Front'].includes(data.mode) ? data.mode : 'Shoulder';
      disableOutsideMatch = Boolean(data.disableOutsideMatch);
      applyNativeState();
    });

    if (typeof bridge.provide === 'function') {
      bridge.provide('thirdperson', {
        getEye: () => bridge.getEye()
      });
    }

    bridge.onBeforePlayerUpdate(applyNativeState);
    setInterval(applyNativeState, 150);
  }
})();
