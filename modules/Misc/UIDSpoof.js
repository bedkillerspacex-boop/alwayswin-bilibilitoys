(() => {
  'use strict';

  const CHANNEL = 'solstice-uidspoof';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const CUSTOM_UID_STORAGE_KEY = 'solstice.uidspoof.customUid';
  const HEARTBEAT_MS = 500;
  let lastSentKey = '';
  let lastSentAt = 0;

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  function getStoredCustomUid() {
    try {
      return String(localStorage.getItem(CUSTOM_UID_STORAGE_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  function setStoredCustomUid(value) {
    try {
      const clean = String(value || '').trim();

      if (clean) {
        localStorage.setItem(CUSTOM_UID_STORAGE_KEY, clean);
      } else {
        localStorage.removeItem(CUSTOM_UID_STORAGE_KEY);
      }
    } catch {

    }
  }

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}/toy/golden-hour/`)) {
        return frame;
      }
    }
    return null;
  }

  function promptCustomUid(module) {
    const current = getStoredCustomUid();
    const input = window.prompt(
      'Enter custom UID (18-digit number, e.g. 123456789012345678; leave empty to clear):',
      current
    );

    if (input === null) {
      return;
    }

    const clean = input.trim();
    setStoredCustomUid(clean);

    const modeSetting = module.settings.find((entry) => entry.n === 'Mode');
    if (modeSetting && clean) {
      modeSetting.v = 1;
    } else if (modeSetting && !clean && modeSetting.v === 1) {
      modeSetting.v = 0;
    }

    lastSentKey = '';
    lastSentAt = 0;
  }

  function syncConfig() {
    const module = getMod('UIDSpoof');
    if (!module) {
      return;
    }

    const setBtn = module.settings.find((entry) => entry.n === 'Set Custom UID');
    if (setBtn && setBtn.v) {
      setBtn.v = 0;
      promptCustomUid(module);
    }

    const modeSetting = module.settings.find((entry) => entry.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] === 'Custom' ? 'Custom' : 'Random';
    const customUid = getStoredCustomUid();
    module.disp = mode === 'Custom' && customUid ? customUid.slice(-6) : mode;

    const now = performance.now();
    const payload = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(module.on),
      mode,
      customUid
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
    name: 'UIDSpoof',
    desc: 'Sends a random or custom online UID while enabled',
    cat: 'Misc',
    nm: { l: 'uidspoof', ls: 'uid spoof', n: 'UIDSpoof', ns: 'UID Spoof' },
    disp: '',
    settings: [
      { t: 'e', n: 'Mode', d: 'Random generates an 18-digit UID; Custom uses your configured UID.', v: 0, vals: ['Random', 'Custom'] },
      { t: 'b', n: 'Set Custom UID', d: 'Click to enter a custom UID (18-digit number).', v: 0 }
    ],
    onRender: syncConfig,
    defaultOn: false,
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncConfig();
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
    const state = {
      enabled: false,
      used: false,
      mode: 'Random',
      customUid: '',
      uid: '',
      name: ''
    };
    let originalToy = null;
    let wrappedToy = null;
    let hookInstalled = false;
    let originalDescriptor = null;

    function randomUID() {
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      let value = '';
      for (const byte of bytes) {
        value += String(byte % 10);
      }
      return (value[0] === '0' ? '1' : value[0]) + value.slice(1);
    }

    function randomName() {
      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      let suffix = '';
      for (const byte of bytes) {
        suffix += String(byte % 10);
      }
      return `楠炴彃鎲?{suffix}`;
    }

    function freshIdentity() {
      state.uid = state.mode === 'Custom' && state.customUid ? state.customUid : randomUID();
      state.name = randomName();
    }

    freshIdentity();

    function fakeProfile() {
      state.used = true;
      return {
        uid: state.uid,
        toyOpenId: state.uid,
        nickname: state.name
      };
    }


    function wrapToy(value) {
      if (!value) {
        return null;
      }
      return new Proxy(value, {
        get(target, property) {
          if (property === 'getUserProfile') {
            return async (...args) => {
              if (!state.enabled) {
                return Reflect.apply(target.getUserProfile, target, args);
              }
              state.used = true;
              try {
                const profile = await Reflect.apply(target.getUserProfile, target, args);
                if (profile && typeof profile === 'object') {
                  return { ...profile, uid: state.uid, toyOpenId: state.uid };
                }
              } catch {

              }
              return fakeProfile();
            };
          }
          const member = Reflect.get(target, property, target);
          return typeof member === 'function' ? member.bind(target) : member;
        }
      });
    }

    function installHook() {
      if (hookInstalled) {
        return;
      }
      hookInstalled = true;
      originalDescriptor = Object.getOwnPropertyDescriptor(window, 'toy');
      if (originalDescriptor && !originalDescriptor.configurable) {
        originalToy = window.toy;
        wrappedToy = wrapToy(originalToy);
        return;
      }
      if (originalDescriptor?.value) {
        originalToy = originalDescriptor.value;
        wrappedToy = wrapToy(originalToy);
      }
      Object.defineProperty(window, 'toy', {
        configurable: true,
        get() {
          if (wrappedToy) {
            return wrappedToy;
          }
          return originalToy;
        },
        set(value) {
          originalToy = value;
          wrappedToy = wrapToy(value);
        }
      });
    }

    installHook();

    function rewriteMessage(data) {
      if (!state.enabled || data === null || data === undefined) {
        return data;
      }
      if (typeof data === 'string') {
        if (!data.includes('"type":"hello"') && !data.includes('"type": "hello"')) {
          return data;
        }
        try {
          const message = JSON.parse(data);
          if (!message || message.type !== 'hello') {
            return data;
          }
          message.uid = state.uid;
          return JSON.stringify(message) + (data.endsWith('\n') ? '\n' : '');
        } catch {
          return data;
        }
      }
      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (bytes.byteLength > 16384 || bytes[0] !== 0x7b) {
          return data;
        }
        try {
          const text = new TextDecoder().decode(bytes);
          const message = JSON.parse(text);
          if (!message || message.type !== 'hello') {
            return data;
          }
          message.uid = state.uid;
          return new TextEncoder().encode(JSON.stringify(message) + (text.endsWith('\n') ? '\n' : ''));
        } catch {
          return data;
        }
      }
      return data;
    }

    function installNetworkHook() {
      if (typeof WebSocket === 'function' && !WebSocket.prototype.send.__solsticeUidSpoof) {
        const originalSend = WebSocket.prototype.send;
        const send = function send(data) {
          return originalSend.call(this, rewriteMessage(data));
        };
        Object.defineProperty(send, '__solsticeUidSpoof', { value: true });
        WebSocket.prototype.send = send;
      }
      if (typeof RTCDataChannel === 'function' && !RTCDataChannel.prototype.send.__solsticeUidSpoof) {
        const originalSend = RTCDataChannel.prototype.send;
        const send = function send(data) {
          return originalSend.call(this, rewriteMessage(data));
        };
        Object.defineProperty(send, '__solsticeUidSpoof', { value: true });
        RTCDataChannel.prototype.send = send;
      }
      if (typeof WritableStreamDefaultWriter === 'function' && !WritableStreamDefaultWriter.prototype.write.__solsticeUidSpoof) {
        const originalWrite = WritableStreamDefaultWriter.prototype.write;
        const write = function write(chunk) {
          return originalWrite.call(this, rewriteMessage(chunk));
        };
        Object.defineProperty(write, '__solsticeUidSpoof', { value: true });
        WritableStreamDefaultWriter.prototype.write = write;
      }
    }

    installNetworkHook();
    setInterval(installNetworkHook, 500);

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }
      const wasEnabled = state.enabled;
      const prevMode = state.mode;
      const prevCustomUid = state.customUid;
      state.enabled = Boolean(data.enabled);
      state.mode = data.mode === 'Custom' ? 'Custom' : 'Random';
      state.customUid = typeof data.customUid === 'string' ? data.customUid.trim() : '';

      if (!wasEnabled && state.enabled) {
        freshIdentity();
      } else if (state.enabled && (prevMode !== state.mode || prevCustomUid !== state.customUid)) {
        state.uid = state.mode === 'Custom' && state.customUid ? state.customUid : randomUID();
      }

      if (wasEnabled && !state.enabled && state.used) {
        setTimeout(() => location.reload(), 100);
      }
    });
  }
})();
