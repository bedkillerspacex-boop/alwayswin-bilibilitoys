(() => {
  'use strict';

  const CHANNEL = 'solstice-uidspoof';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const CUSTOM_NAME_STORAGE_KEY = 'solstice.potato.uidspoof.name';
  const CUSTOM_UID_STORAGE_KEY = 'solstice.potato.uidspoof.customUid';
  const gamePrefix = () => (document.documentElement?.getAttribute('data-solstice-game') === 'potatoepic' || location.pathname.includes('/potatoepic/')) ? '/toy/potatoepic/' : '/toy/golden-hour/';
  const HEARTBEAT_MS = 500;
  let lastSentKey = '';
  let lastSentAt = 0;

  if (location.hostname === 'www.bilibilitoy.com' && (location.pathname.startsWith('/toy/golden-hour/') || location.pathname.startsWith('/toy/potatoepic/'))) {
    bootGame();
    return;
  }

  function getStoredCustomName() {
    try {
      return String(localStorage.getItem(CUSTOM_NAME_STORAGE_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  function setStoredCustomName(value) {
    try {
      const clean = String(value || '').trim().slice(0, 24);
      if (clean) {
        localStorage.setItem(CUSTOM_NAME_STORAGE_KEY, clean);
      } else {
        localStorage.removeItem(CUSTOM_NAME_STORAGE_KEY);
      }
    } catch {}
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
    } catch {}
  }

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}${gamePrefix()}`)) {
        return frame;
      }
    }
    return null;
  }

  function syncConfig() {
    const module = getMod('UIDSpoof');
    if (!module) {
      return;
    }

    const setNameBtn = module.settings.find((entry) => entry.n === 'Set Name');
    if (setNameBtn && setNameBtn.v) {
      setNameBtn.v = 0;
      const input = window.prompt('输入伪装名字（留空则使用原账号名）:', getStoredCustomName());
      if (input !== null) {
        setStoredCustomName(input);
        lastSentKey = '';
        lastSentAt = 0;
      }
    }

    const setUidBtn = module.settings.find((entry) => entry.n === 'Set Custom UID');
    if (setUidBtn && setUidBtn.v) {
      setUidBtn.v = 0;
      const input = window.prompt('输入自定义 UID（如 toid_v1_k01_RRi_...，留空则恢复随机）:', getStoredCustomUid());
      if (input !== null) {
        const clean = input.trim();
        setStoredCustomUid(clean);
        const modeSetting = module.settings.find((entry) => entry.n === 'Mode');
        if (modeSetting && clean) modeSetting.v = 1;
        else if (modeSetting && !clean && modeSetting.v === 1) modeSetting.v = 0;
        lastSentKey = '';
        lastSentAt = 0;
      }
    }

    const modeSetting = module.settings.find((entry) => entry.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] === 'Custom' ? 'Custom' : 'Random';
    const customUid = getStoredCustomUid();
    const customName = getStoredCustomName();
    module.disp = customName || (mode === 'Custom' && customUid ? customUid.slice(-6) : mode);

    const now = performance.now();
    const payload = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(module.on),
      mode,
      customUid,
      customName
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
    desc: 'Spoofs the online UID, custom name, and 16x16 random avatar.',
    cat: 'Misc',
    nm: { l: 'uidspoof', ls: 'uid spoof', n: 'UIDSpoof', ns: 'UID Spoof' },
    disp: '',
    settings: [
      { t: 'e', n: 'Mode', d: 'Random generates a random UID; Custom uses your configured UID.', v: 0, vals: ['Random', 'Custom'] },
      { t: 'b', n: 'Set Custom UID', d: 'Click to enter a custom UID.', v: 0 },
      { t: 'b', n: 'Set Name', d: 'Click to set a custom spoofed name (empty = account name).', v: 0 }
    ],
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
    if (bridge.game === 'potatoepic') {
      installPotatoUidSpoof(bridge);
      return;
    }

    const state = {
      enabled: false,
      used: false,
      uid: ''
    };
    let originalToy = null;
    let wrappedToy = null;
    let hookInstalled = false;
    let originalDescriptor = null;

    function randomUID() {
      const bytes = new Uint8Array(30);
      crypto.getRandomValues(bytes);
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      return `toid_v1_k01_RRi_${encoded}`;
    }


    function freshIdentity() {
      state.uid = randomUID();
    }

    freshIdentity();

    function fakeProfile() {
      state.used = true;
      return {
        uid: state.uid,
        toyOpenId: state.uid
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
              freshIdentity();
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
      state.enabled = Boolean(data.enabled);
      if (!wasEnabled && state.enabled) {
        freshIdentity();
      }
      if (wasEnabled && !state.enabled && state.used) {
        setTimeout(() => location.reload(), 100);
      }
    });
  }

  function installPotatoUidSpoof(bridge) {
    let enabled = false;
    let used = false;
    let uid = '';
    let mode = 'Random';
    let customUid = '';
    let customName = '';
    let avatarUrl = '';

    function randomUid() {
      const bytes = new Uint8Array(30);
      crypto.getRandomValues(bytes);
      let binary = '';

      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

      const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      return `toid_v1_k01_RRi_${encoded}`;
    }

    function randomBlockAvatar() {
      try {
        const c = document.createElement('canvas');
        c.width = 16;
        c.height = 16;
        const ctx = c.getContext('2d');
        if (!ctx) return DEFAULT_AVATAR;
        const palette = [];
        const baseHue = Math.floor(Math.random() * 360);
        for (let i = 0; i < 4; i++) {
          const h = (baseHue + i * 35) % 360;
          const s = 55 + Math.floor(Math.random() * 35);
          const l = 38 + Math.floor(Math.random() * 35);
          palette.push(`hsl(${h},${s}%,${l}%)`);
        }
        for (let y = 0; y < 16; y += 2) {
          for (let x = 0; x < 8; x += 2) {
            const col = palette[Math.floor(Math.random() * palette.length)];
            ctx.fillStyle = col;
            ctx.fillRect(x, y, 2, 2);
            ctx.fillRect(14 - x, y, 2, 2);
          }
        }
        return c.toDataURL('image/png');
      } catch {
        return DEFAULT_AVATAR;
      }
    }

    function freshIdentity() {
      uid = mode === 'Custom' && customUid ? customUid : randomUid();
      avatarUrl = randomBlockAvatar();
    }

    function getToy() {
      try {
        return typeof Toy !== 'undefined' ? Toy : null;
      } catch {
        return null;
      }
    }

    const DEFAULT_AVATAR = 'https://i0.hdslb.com/bfs/face/member/noface.jpg';

    function profileIdentity() {
      let baseNick = '';
      try {
        if (typeof Account !== 'undefined' && Account.data) {
          baseNick = Account.data.nick || Account.data.name || '';
        }
      } catch {}

      return {
        nickname: customName || baseNick,
        avatar: avatarUrl || DEFAULT_AVATAR
      };
    }

    function applyAccountSpoof() {
      if (!enabled) return;
      try {
        if (typeof Account !== 'undefined' && Account.data) {
          if (customName) {
            Account.data.nick = customName;
            Account.data.name = customName;
          }
          if (avatarUrl) {
            Account.data.avatar = avatarUrl;
          }
        }
      } catch {}
    }

    function clearBanState() {
      try {
        localStorage.removeItem('potato:ban');
      } catch {

      }
    }

    function installHook() {
      const toy = getToy();

      if (!toy || typeof toy.profile !== 'function' || toy.profile.__solsticePotatoUidSpoof) {
        return;
      }

      const originalProfile = toy.profile;
      const wrappedProfile = async function wrappedPotatoUidProfile(...args) {
        if (!enabled) {
          return originalProfile.apply(this, args);
        }

        used = true;
        applyAccountSpoof();
        return {
          ...profileIdentity(),
          uid,
          toyOpenId: uid
        };
      };

      Object.defineProperty(wrappedProfile, '__solsticePotatoUidSpoof', { value: true });
      toy.profile = wrappedProfile;
    }

    let originalLoadGate = null;

    function installLoginBypass() {
      if (
        typeof Account === 'undefined' ||
        typeof Account.loadGate !== 'function' ||
        Account.loadGate.__solsticePotatoUidNoLogin
      ) {
        return;
      }

      originalLoadGate = Account.loadGate;
      const wrappedLoadGate = async function wrappedPotatoUidNoLoginGate() {
        if (!enabled) {
          return originalLoadGate.apply(this, arguments);
        }

        return { requireAccount: false, follow: false, triple: false };
      };

      Object.defineProperty(wrappedLoadGate, '__solsticePotatoUidNoLogin', { value: true });
      Account.loadGate = wrappedLoadGate;
    }

    function removeLoginBypass() {
      if (originalLoadGate && Account.loadGate?.__solsticePotatoUidNoLogin) {
        Account.loadGate = originalLoadGate;
      }

      originalLoadGate = null;
    }

    freshIdentity();

    function installLoginHook() {
      if (
        typeof Account === 'undefined' ||
        typeof Account.loginBili !== 'function' ||
        Account.loginBili.__solsticePotatoUidLogin
      ) {
        return;
      }

      const originalLoginBili = Account.loginBili;
      const wrappedLoginBili = async function wrappedPotatoUidLoginBili(...args) {
        if (enabled) {
          clearBanState();
          freshIdentity();
        }

        return originalLoginBili.apply(this, args);
      };

      Object.defineProperty(wrappedLoginBili, '__solsticePotatoUidLogin', { value: true });
      Account.loginBili = wrappedLoginBili;
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }

      const wasEnabled = enabled;
      const prevMode = mode;
      const prevCustomUid = customUid;
      enabled = Boolean(data.enabled);
      mode = data.mode === 'Custom' ? 'Custom' : 'Random';
      customUid = String(data.customUid || '').trim();
      customName = String(data.customName || '').trim().slice(0, 24);

      if ((!wasEnabled && enabled) || (enabled && (prevMode !== mode || prevCustomUid !== customUid))) {
        freshIdentity();
        clearBanState();
        installHook();
        installLoginBypass();
        applyAccountSpoof();
      } else if (enabled) {
        applyAccountSpoof();
      }

      if (wasEnabled && !enabled && used) {
        removeLoginBypass();
        setTimeout(() => location.reload(), 100);
      }
    });

    installHook();
    installLoginHook();
    installLoginBypass();
    setInterval(installHook, 500);
    setInterval(installLoginHook, 500);
    setInterval(installLoginBypass, 500);
  }
})();
