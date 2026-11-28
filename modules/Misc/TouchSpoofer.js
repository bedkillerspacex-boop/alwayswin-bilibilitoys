(() => {
  'use strict';

  const CHANNEL = 'solstice-touchspoofer';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const isPotatoPath = () => location.pathname.includes('/potatoepic/') || document.documentElement?.getAttribute('data-solstice-game') === 'potatoepic';
  const STORAGE_KEY = () => (isPotatoPath() ? 'solstice.potato.touchspoofer.enabled' : 'solstice.touchspoofer.enabled');
  const KBM_KEY = () => (isPotatoPath() ? 'solstice.potato.touchspoofer.kbm' : 'solstice.touchspoofer.kbm');
  const MATCH_PC_KEY = () => (isPotatoPath() ? 'solstice.potato.touchspoofer.matchPc' : 'solstice.touchspoofer.matchPc');

  if (
    location.hostname === 'www.bilibilitoy.com' &&
    (location.pathname.startsWith('/toy/golden-hour/') || location.pathname.startsWith('/toy/potatoepic/'))
  ) {
    bootGame();
    return;
  }

  let lastSentKey = '';
  let lastSentAt = 0;

  function findGameFrame() {
    const prefix = isPotatoPath() ? '/toy/potatoepic/' : '/toy/golden-hour/';
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}${prefix}`)) {
        return frame;
      }
    }
    return null;
  }

  function setting(mod, name, fallback) {
    const s = mod?.settings?.find((e) => e.n === name);
    return s ? s.v : fallback;
  }

  function syncConfig(force = false) {
    const mod = typeof getMod === 'function' ? getMod('TouchSpoofer') : null;
    if (!mod) return;

    const now = performance.now();
    const payload = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(mod.on),
      keepKbm: Boolean(setting(mod, 'Keep KBM', true)),
      matchPc: Boolean(setting(mod, 'Match PC', false))
    };
    const key = JSON.stringify(payload);
    if (!force && key === lastSentKey && now - lastSentAt < 500) return;

    const frame = findGameFrame();
    if (!frame?.contentWindow) return;

    frame.contentWindow.postMessage(payload, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    name: 'TouchSpoofer',
    desc: 'Spoofs local & remote device checks as mobile touch while keeping keyboard and mouse controls.',
    cat: 'Misc',
    nm: { l: 'touchspoofer', ls: 'touch spoofer', n: 'TouchSpoofer', ns: 'Touch Spoofer' },
    disp: '',
    settings: [
      { t: 'b', n: 'Keep KBM', d: 'Keep pointer lock and keyboard/mouse controls active while spoofing mobile.', v: 1 },
      { t: 'b', n: 'Match PC', d: 'Allow matching with PC players while spoofing mobile (off = mobile-only pool).', v: 0 }
    ],
    onRender: () => syncConfig(false),
    defaultOn: false,
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncConfig(true);
    }
  });

  function bootGame() {
    let enabled = false;
    let keepKbm = true;
    let matchPc = false;

    try {
      enabled = localStorage.getItem(STORAGE_KEY()) === '1';
      keepKbm = localStorage.getItem(KBM_KEY()) !== '0';
      matchPc = localStorage.getItem(MATCH_PC_KEY()) === '1';
    } catch {}

    const initialEnabled = enabled;

    function saveState(nextEnabled, nextKbm, nextMatchPc) {
      try {
        localStorage.setItem(STORAGE_KEY(), nextEnabled ? '1' : '0');
        localStorage.setItem(KBM_KEY(), nextKbm ? '1' : '0');
        localStorage.setItem(MATCH_PC_KEY(), nextMatchPc ? '1' : '0');
      } catch {}
    }

    function applyEnvironmentSpoof() {
      if (!enabled) return;

      const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
      const defineNav = (prop, getter) => {
        try {
          Object.defineProperty(Navigator.prototype, prop, {
            configurable: true,
            get: getter
          });
        } catch {
          try {
            Object.defineProperty(navigator, prop, {
              configurable: true,
              get: getter
            });
          } catch {}
        }
      };

      defineNav('maxTouchPoints', () => 5);
      defineNav('userAgent', () => MOBILE_UA);
      defineNav('platform', () => 'Linux armv8l');
      defineNav('userAgentData', () => ({
        brands: [
          { brand: 'Chromium', version: '120' },
          { brand: 'Google Chrome', version: '120' },
          { brand: 'Not_A Brand', version: '24' }
        ],
        mobile: true,
        platform: 'Android',
        getHighEntropyValues: async () => ({
          architecture: 'arm',
          bitness: '64',
          brands: [
            { brand: 'Chromium', version: '120' },
            { brand: 'Google Chrome', version: '120' }
          ],
          mobile: true,
          model: 'Pixel 7',
          platform: 'Android',
          platformVersion: '13.0.0'
        }),
        toJSON() {
          return { brands: this.brands, mobile: true, platform: 'Android' };
        }
      }));

      try {
        if (!('ontouchstart' in window)) {
          Object.defineProperty(window, 'ontouchstart', {
            configurable: true,
            writable: true,
            value: null
          });
        }
        if (!('ontouchstart' in document)) {
          Object.defineProperty(document, 'ontouchstart', {
            configurable: true,
            writable: true,
            value: null
          });
        }
      } catch {}

      if (typeof window.matchMedia === 'function' && !window.matchMedia.__solsticeTouchSpoof) {
        const nativeMatchMedia = window.matchMedia.bind(window);
        const wrappedMatchMedia = function matchMedia(query) {
          const res = nativeMatchMedia(query);
          if (!enabled || typeof query !== 'string') return res;

          const q = query.toLowerCase();
          let forced = null;
          if (q.includes('pointer: coarse') || q.includes('any-pointer: coarse') || q.includes('hover: none') || q.includes('any-hover: none')) {
            forced = true;
          } else if (q.includes('pointer: fine') || q.includes('any-pointer: fine') || q.includes('hover: hover') || q.includes('any-hover: hover')) {
            forced = false;
          }

          if (forced === null) return res;
          return new Proxy(res, {
            get(target, prop) {
              if (prop === 'matches') return forced;
              const val = Reflect.get(target, prop, target);
              return typeof val === 'function' ? val.bind(target) : val;
            }
          });
        };
        Object.defineProperty(wrappedMatchMedia, '__solsticeTouchSpoof', { value: true });
        window.matchMedia = wrappedMatchMedia;
      }
    }

    function spoofPayloadObject(obj, depth = 0) {
      if (!obj || typeof obj !== 'object' || depth > 4) return false;
      let changed = false;

      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (spoofPayloadObject(item, depth + 1)) changed = true;
        }
        return changed;
      }

      for (const key of Object.keys(obj)) {
        const val = obj[key];
        const lower = key.toLowerCase();

        if (typeof val === 'boolean') {
          if (lower === 'mobile' || lower === 'ismobile' || lower === 'touch' || lower === 'istouch' || lower === 'hastouch' || lower === 'touchscreen') {
            if (!val) {
              obj[key] = true;
              changed = true;
            }
          } else if (
            lower === 'matchpc' || lower === 'allowpc' || lower === 'crossplay' ||
            lower === 'crossplatform' || lower === 'matchdesktop' || lower === 'withpc' ||
            lower === 'pcqueue' || lower === 'mixedqueue' || lower === 'allowkbm' || lower === 'matchkbm'
          ) {
            if (val !== matchPc) {
              obj[key] = matchPc;
              changed = true;
            }
          } else if (lower === 'mobileonly' || lower === 'touchonly' || lower === 'sameplatform') {
            if (val !== !matchPc) {
              obj[key] = !matchPc;
              changed = true;
            }
          }
        } else if (typeof val === 'string') {
          const vLower = val.toLowerCase();
          if ((lower === 'platform' || lower === 'device' || lower === 'devicetype' || lower === 'clienttype') &&
              (vLower === 'pc' || vLower === 'desktop' || vLower === 'web' || vLower === 'windows' || vLower === 'mac')) {
            obj[key] = 'mobile';
            changed = true;
          } else if ((lower === 'input' || lower === 'inputmode' || lower === 'controlmode' || lower === 'controls') &&
              (vLower === 'kbm' || vLower === 'keyboard' || vLower === 'mouse' || vLower === 'pc' || vLower === 'desktop')) {
            obj[key] = 'touch';
            changed = true;
          }
        } else if (val && typeof val === 'object') {
          if (spoofPayloadObject(val, depth + 1)) changed = true;
        }
      }

      return changed;
    }

    function rewriteJsonString(str) {
      if (!enabled || typeof str !== 'string' || str.length > 65536 || str[0] !== '{') {
        return str;
      }
      try {
        const parsed = JSON.parse(str);
        if (spoofPayloadObject(parsed)) {
          return JSON.stringify(parsed) + (str.endsWith('\n') ? '\n' : '');
        }
      } catch {}
      return str;
    }

    function installNetworkSpoof() {
      if (typeof WebSocket === 'function' && !WebSocket.prototype.send.__solsticeTouchSpoof) {
        const nativeSend = WebSocket.prototype.send;
        const wrappedSend = function send(data) {
          return nativeSend.call(this, rewriteJsonString(data));
        };
        Object.defineProperty(wrappedSend, '__solsticeTouchSpoof', { value: true });
        WebSocket.prototype.send = wrappedSend;
      }

      if (typeof window.fetch === 'function' && !window.fetch.__solsticeTouchSpoof) {
        const nativeFetch = window.fetch;
        const wrappedFetch = function fetch(input, init) {
          if (enabled && init && typeof init.body === 'string') {
            const nextBody = rewriteJsonString(init.body);
            if (nextBody !== init.body) {
              init = { ...init, body: nextBody };
            }
          }
          return nativeFetch.call(this, input, init);
        };
        Object.defineProperty(wrappedFetch, '__solsticeTouchSpoof', { value: true });
        window.fetch = wrappedFetch;
      }
    }

    function installKbmFallback() {
      document.addEventListener('mousedown', (event) => {
        if (!enabled || !keepKbm || event.button !== 0) return;
        if (window.SolsticeGame?.uiOpen) return;
        const g = window.game;
        if (g && (g.state !== 'play' || g.ui?.screen)) return;

        const target = event.target;
        const canvas = target instanceof HTMLCanvasElement ? target : document.querySelector('canvas');
        if (!canvas || document.pointerLockElement === canvas) return;
        if (target !== canvas && target !== document.body && target !== document.documentElement) return;

        try {
          canvas.requestPointerLock?.();
        } catch {}
      }, false);
    }

    applyEnvironmentSpoof();
    installNetworkSpoof();
    setInterval(() => {
      installNetworkSpoof();
      if (enabled && keepKbm) {
        if (window.game?.settings && window.game.settings.rotatePortrait !== false) {
          window.game.settings.rotatePortrait = false;
        }
        try {
          if (typeof Stage !== 'undefined' && Stage && typeof Stage.want === 'function' && !Stage.want.__solsticeNoRot) {
            const origWant = Stage.want;
            const wrappedWant = function noRotWant(...args) {
              if (enabled && keepKbm) return false;
              return origWant.apply(this, args);
            };
            Object.defineProperty(wrappedWant, '__solsticeNoRot', { value: true });
            Stage.want = wrappedWant;
            if (Stage.rot && typeof Stage.update === 'function') {
              Stage.update();
            }
          }
        } catch {}
      }
    }, 100);
    installKbmFallback();

    window.addEventListener('message', (event) => {
      if (event.origin !== 'https://www.bilibili.com') return;
      const data = event.data;
      if (!data || data.channel !== CHANNEL || data.type !== 'config') return;

      const nextEnabled = Boolean(data.enabled);
      const nextKbm = data.keepKbm !== false;
      const nextMatchPc = Boolean(data.matchPc);
      saveState(nextEnabled, nextKbm, nextMatchPc);

      const changed = nextEnabled !== enabled;
      enabled = nextEnabled;
      keepKbm = nextKbm;
      matchPc = nextMatchPc;

      if (changed && (enabled !== initialEnabled || initialEnabled !== nextEnabled)) {
        setTimeout(() => location.reload(), 80);
      }
    });
  }
})();
