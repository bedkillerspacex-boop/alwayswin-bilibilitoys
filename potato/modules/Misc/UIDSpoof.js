(() => {
  'use strict';

  const CHANNEL = 'solstice-uidspoof';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const CUSTOM_NAME_STORAGE_KEY = 'solstice.potato.uidspoof.name';
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
      if (clean) localStorage.setItem(CUSTOM_NAME_STORAGE_KEY, clean);
      else localStorage.removeItem(CUSTOM_NAME_STORAGE_KEY);
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
      const input = window.prompt('输入自定义 Bilibili 名字（留空则使用原账号名）:', getStoredCustomName());
      if (input !== null) {
        setStoredCustomName(input);
        lastSentKey = '';
        lastSentAt = 0;
      }
    }
    const customName = getStoredCustomName();
    module.disp = customName || '';
    const now = performance.now();
    const payload = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(module.on),
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
    desc: 'Spoofs the online UID and disables the Potato login gate.',
    cat: 'Misc',
    nm: { l: 'uidspoof', ls: 'uid spoof', n: 'UIDSpoof', ns: 'UID Spoof' },
    disp: '',
    settings: [
      { t: 'b', n: 'Set Name', d: 'Click to set a custom Bilibili nickname.', v: 0 }
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
    let customName = '';

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

    function uidFromSeed(seedText) {
      const text = String(seedText || '').trim();
      if (!text) return '';

      const input = new TextEncoder().encode(`alwayswin:uid:v1:${text}`);
      let h1 = 0x811c9dc5 >>> 0;
      let h2 = 0x9e3779b9 >>> 0;
      let h3 = 0x85ebca6b >>> 0;
      let h4 = 0xc2b2ae35 >>> 0;

      for (let i = 0; i < input.length; i++) {
        const b = input[i];
        h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
        h2 = Math.imul((h2 + b + (i * 17)) >>> 0, 0x85ebca6b) >>> 0;
        h3 = Math.imul(h3 ^ (b + ((i + 1) * 31)), 0xc2b2ae35) >>> 0;
        h4 = Math.imul((h4 ^ (b << (i & 7))) >>> 0, 0x27d4eb2d) >>> 0;
      }

      const mix32 = (x) => {
        x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
        x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
        return (x ^ (x >>> 16)) >>> 0;
      };

      let s0 = mix32(h1 ^ h2);
      let s1 = mix32(h2 ^ h3);
      let s2 = mix32(h3 ^ h4);
      let s3 = mix32(h4 ^ h1);
      if ((s0 | s1 | s2 | s3) === 0) s0 = 0x6d2b79f5;

      const nextU32 = () => {
        const result = Math.imul(((s1 * 5) << 7) | ((s1 * 5) >>> 25), 9) >>> 0;
        const t = (s1 << 9) >>> 0;
        s2 ^= s0;
        s3 ^= s1;
        s1 ^= s2;
        s0 ^= s3;
        s2 ^= t;
        s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
        return result;
      };

      const bytes = new Uint8Array(30);
      for (let i = 0; i < 30; i += 4) {
        const r = nextU32();
        bytes[i] = r & 0xff;
        if (i + 1 < 30) bytes[i + 1] = (r >>> 8) & 0xff;
        if (i + 2 < 30) bytes[i + 2] = (r >>> 16) & 0xff;
        if (i + 3 < 30) bytes[i + 3] = (r >>> 24) & 0xff;
      }

      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

      const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      return `toid_v1_k01_RRi_${encoded}`;
    }

    function resolveSeedName() {
      if (customName) return customName;
      try {
        if (typeof Account !== 'undefined') {
          return String(Account.data?.nick || Account.data?.name || Account.name || '').trim();
        }
      } catch {}
      return '';
    }

    const LAST_UID_KEY = 'solstice.potato.uidspoof.lastUid';

    function loadSavedUid() {
      try {
        const saved = String(localStorage.getItem(LAST_UID_KEY) || '').trim();
        return saved.startsWith('toid_v1_k01_RRi_') ? saved : '';
      } catch {
        return '';
      }
    }

    function saveUid(value) {
      try {
        if (value && value.startsWith('toid_v1_k01_RRi_')) {
          localStorage.setItem(LAST_UID_KEY, value);
        }
      } catch {}
    }

    function freshIdentity() {
      const seedName = resolveSeedName();
      if (seedName) {
        uid = uidFromSeed(seedName);
      } else {
        uid = loadSavedUid() || randomUid();
      }
      saveUid(uid);
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
      try {
        if (typeof Account !== 'undefined' && Account.data) {
          return {
            nickname: customName || Account.data.nick || Account.data.name || '',
            avatar: Account.data.avatar || DEFAULT_AVATAR
          };
        }
      } catch {

      }

      return { nickname: customName || '', avatar: DEFAULT_AVATAR };
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
        const identity = profileIdentity();
        const resolvedUid = identity.nickname ? uidFromSeed(identity.nickname) : (uid || loadSavedUid() || randomUid());
        uid = resolvedUid;
        saveUid(resolvedUid);
        return {
          ...identity,
          uid: resolvedUid,
          toyOpenId: resolvedUid
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
      const prevName = customName;
      enabled = Boolean(data.enabled);
      customName = String(data.customName || '').trim().slice(0, 24);

      if ((!wasEnabled && enabled) || (enabled && customName !== prevName)) {
        freshIdentity();
        clearBanState();
        installHook();
        installLoginBypass();
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
