

(() => {
  'use strict';

  const Protocol = globalThis.SolsticeProtocol;

  if (!Protocol || !Protocol.isTargetLocation(window.location)) {
    return;
  }

  if (window.__solsticeControllerV1) {
    return;
  }

  Object.defineProperty(window, '__solsticeControllerV1', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const FONT_FACES = [
    ['Product Sans', 400, 'Product-Sans.ttf'],
    ['Product Sans', 700, 'Product-Sans-Bold.ttf'],
    ['Mojangles', 400, 'Mojangles.ttf'],
    ['Mojangles', 700, 'Mojangles-Bold.ttf'],
    ['Tenacity Icons', 400, 'Tenacity-Icons.ttf']
  ];
  const KEY_CHANNEL = 'solstice-key';

  function injectFonts() {
    const host = document.head || document.documentElement;

    if (!host || document.getElementById('solstice-fonts')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'solstice-fonts';
    style.textContent = FONT_FACES.map(([family, weight, file]) => (
      `@font-face{font-family:"${family}";font-weight:${weight};font-display:block;` +
      `src:url("${chrome.runtime.getURL(`assets/fonts/${file}`)}") format("truetype")}`
    )).join('\n');

    host.append(style);
  }

  function scheduleFontInjection() {
    if (document.documentElement) {
      try {
        injectFonts();
      } catch {

      }
    }

    if (!document.getElementById('solstice-fonts')) {
      document.addEventListener('DOMContentLoaded', injectFonts, { once: true });
    }
  }

  function exposeAudioBase() {
    const root = document.documentElement;

    if (root && !root.hasAttribute('data-solstice-audio-base')) {
      root.setAttribute('data-solstice-audio-base', chrome.runtime.getURL('assets/audio/'));
    }
  }

  function exposeSevenDays() {
    const root = document.documentElement;

    if (root && !root.hasAttribute('data-solstice-seven')) {
      root.setAttribute('data-solstice-seven', chrome.runtime.getURL('assets/img/seven_days.png'));
    }

    if (root && !root.hasAttribute('data-solstice-alwayswin')) {
      root.setAttribute('data-solstice-alwayswin', chrome.runtime.getURL('assets/img/alwayswin.png'));
    }

    if (root && !root.hasAttribute('data-solstice-notch')) {
      root.setAttribute('data-solstice-notch', chrome.runtime.getURL('assets/img/notch.png'));
    }

    if (root && !root.hasAttribute('data-solstice-game')) {
      root.setAttribute('data-solstice-game', Protocol.GAME.pathPrefix.includes('/potatoepic/') ? 'potatoepic' : 'goldenhour');
    }
  }

  function emitUiEvent(type) {
    document.dispatchEvent(new CustomEvent(type));
  }

  function isUiOpen() {
    return Boolean(document.documentElement?.hasAttribute('data-solstice-open'));
  }

  function gameFrames() {
    const frames = [];

    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const url = new URL(frame.src, location.href);

        if (url.origin === Protocol.GAME.origin && url.pathname.startsWith(Protocol.GAME.pathPrefix)) {
          frames.push(frame);
        }
      } catch {

      }
    }

    return frames;
  }

  function isGameFrameSource(source) {
    if (!source) {
      return false;
    }

    return gameFrames().some((frame) => frame.contentWindow === source);
  }

  function broadcastUiState() {
    const open = isUiOpen();
    const message = {
      channel: Protocol.GAME.channel,
      type: 'state',
      open
    };

    for (const frame of gameFrames()) {
      try {
        frame.contentWindow?.postMessage(message, Protocol.GAME.origin);
      } catch {

      }
    }
  }

  function setupUiStateBroadcast() {
    const root = document.documentElement;

    if (!root) {
      document.addEventListener('DOMContentLoaded', setupUiStateBroadcast, { once: true });
      return;
    }

    new MutationObserver(broadcastUiState).observe(root, {
      attributes: true,
      attributeFilter: ['data-solstice-open']
    });
  }

  function handleGameMessage(event) {
    if (event.origin !== Protocol.GAME.origin) {
      return;
    }

    if (!isGameFrameSource(event.source)) {
      return;
    }

    const data = event.data;

    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.channel === KEY_CHANNEL) {
      if (data.type !== 'key' || (data.key !== 'Insert' && data.key !== 'Escape')) {
        return;
      }

      const request = new CustomEvent('solstice:key', {
        detail: {
          key: data.key,
          keyCode: Number(data.keyCode) || 0,
          handled: false
        }
      });

      window.dispatchEvent(request);
      return;
    }

    if (data.channel !== Protocol.GAME.channel || typeof data.type !== 'string') {
      return;
    }

    if (data.type === 'hello') {
      event.source.postMessage(
        {
          channel: Protocol.GAME.channel,
          type: 'ack',
          open: isUiOpen()
        },
        Protocol.GAME.origin
      );
      return;
    }

    if (data.type === 'toggle') {
      emitUiEvent(Protocol.UI_EVENTS.TOGGLE);
      return;
    }

    if (data.type === 'close') {
      emitUiEvent(Protocol.UI_EVENTS.CLOSE);
    }
  }

  function getState() {
    const host = document.getElementById('solstice-root');
    const root = document.documentElement;

    return {
      open: Boolean(root?.hasAttribute('data-solstice-open')),
      mounted: Boolean(host),
      target: Protocol.TARGET.href
    };
  }

  /* ── config file bridge: page (MAIN) → isolated → background ────── */

  function handleConfigRequest(event) {
    if (event.source && event.source !== window) {
      return;
    }

    const data = event.data;

    if (!data || data.channel !== 'solstice-cfg' || typeof data.action !== 'string') {
      return;
    }

    const reply = (result) => {
      try {
        window.postMessage({
          channel: 'solstice-cfg-res',
          id: data.id,
          result: result || null
        }, '*');
      } catch {

      }
    };

    try {
      chrome.runtime.sendMessage({
        channel: 'solstice',
        protocol: Protocol ? Protocol.PROTOCOL_VERSION : 1,
        source: 'solstice-page',
        type: 'solstice/cfg',
        action: data.action,
        scope: data.scope,
        name: data.name,
        folder: data.folder,
        content: data.content,
        store: data.store,
        active: data.active
      }, (response) => {
        if (chrome.runtime.lastError) {
          reply({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        reply(response);
      });
    } catch (error) {
      reply({ ok: false, error: String(error) });
    }
  }

  function handleRuntimeMessage(message, sender, sendResponse) {    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    if (!Protocol.isExtensionMessage(message)) {
      return false;
    }

    switch (message.type) {
      case Protocol.MESSAGES.GET_STATE:
        sendResponse({ ok: true, state: getState() });
        return false;

      case Protocol.MESSAGES.OPEN:
        emitUiEvent(Protocol.UI_EVENTS.OPEN);
        sendResponse({ ok: true, state: getState() });
        return false;

      case Protocol.MESSAGES.CLOSE:
        emitUiEvent(Protocol.UI_EVENTS.CLOSE);
        sendResponse({ ok: true, state: getState() });
        return false;

      case Protocol.MESSAGES.TOGGLE:
        emitUiEvent(Protocol.UI_EVENTS.TOGGLE);
        sendResponse({ ok: true, state: getState() });
        return false;

      default:
        return false;
    }
  }

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  window.addEventListener('message', handleGameMessage);
  window.addEventListener('message', handleConfigRequest);
  setupUiStateBroadcast();
  scheduleFontInjection();
  exposeAudioBase();
  exposeSevenDays();
  document.addEventListener('DOMContentLoaded', exposeAudioBase, { once: true });
  document.addEventListener('DOMContentLoaded', exposeSevenDays, { once: true });
})();
