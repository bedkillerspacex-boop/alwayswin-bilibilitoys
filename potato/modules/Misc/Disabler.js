(() => {
  'use strict';

  const CHANNEL = 'solstice-misc';
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

  function setting(mod, name, fallback) {
    const entry = mod?.settings?.find((s) => s.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig(force = false) {
    const mod = getMod('Disabler');
    if (!mod) return;

    const modeSetting = mod.settings.find((s) => s.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] || 'MoeVian';
    mod.disp = mode;

    const now = performance.now();
    const payload = {
      channel: CHANNEL,
      type: 'config',
      module: 'disabler',
      enabled: Boolean(mod.on),
      mode,
      cleanIntegrity: Boolean(setting(mod, 'Clean Integrity', 1)),
      blockFlags: Boolean(setting(mod, 'Block Flags', 1))
    };
    const key = JSON.stringify(payload);

    if (!force && key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const frame = findGameFrame();
    if (!frame?.contentWindow) return;

    frame.contentWindow.postMessage(payload, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    game: 'potatoepic',
    name: 'Disabler',
    desc: 'Handles ladder challenges and cleans outgoing check payloads (MoeVian mode by MoeVian).',
    cat: 'Misc',
    nm: { l: 'disabler', ls: 'disabler', n: 'Disabler', ns: 'Disabler' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'MoeVian (by MoeVian) | Clean Reply | Drop.', v: 0, vals: ['MoeVian', 'Clean Reply', 'Drop'] },
      { t: 'b', n: 'Clean Integrity', d: 'Sanitizes Integrity.report and handshake ic payloads.', v: 1 },
      { t: 'b', n: 'Block Flags', d: 'Suppresses outgoing client-scan flag packets.', v: 1 }
    ],
    onRender: () => syncConfig(false),
    defaultOn: true,
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncConfig(true);
    }
  });

  function startMoeVianTransport() {
    if (window.__PE_REPORT_FILTER__?.active) return;

    (() => {
      'use strict';
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) || location.protocol === 'file:';
      if (!local && !/\/toy\/potatoepic\/\d+-v\d+\//.test(location.pathname)) return;
      if (window.__PE_REPORT_FILTER__?.active) return;

      const records = new Map(), transforms = new Set(), peers = new Map(), channels = new Map(), matches = new Map();
      const counts = { ic: 0, flag: 0, ac: 0 };
      const protocol = { challenges: 0, replies: 0, rejected: 0 };
      let active = true;
      const build = '20261126-121638-2e60';
      const profileData = [
        {"build":"20261126-121638-2e60","key":"db200112a07f724a23f73a7a867acd84","joinHb":1,"extended":false},
        {"build":"20261127-220931-a647","key":"accecacfd3675df6ebdc3932712a6b68","joinHb":2,"extended":true}
      ];
      const shaK = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
      ]);
      const rotate = (n, bits) => n >>> bits | n << 32 - bits;
      function sha256(bytes) {
        const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
        padded.set(bytes); padded[bytes.length] = 128;
        const view = new DataView(padded.buffer), bits = bytes.length * 8;
        view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
        view.setUint32(padded.length - 4, bits >>> 0);
        const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
        const w = new Uint32Array(64);
        for (let offset = 0; offset < padded.length; offset += 64) {
          for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
          for (let i = 16; i < 64; i++) {
            const a = w[i - 15], b = w[i - 2];
            w[i] = w[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ a >>> 3) + w[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ b >>> 10);
          }
          let [a, b, c, d, e, f, g, j] = h;
          for (let i = 0; i < 64; i++) {
            const first = (j + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + shaK[i] + w[i]) >>> 0;
            const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c)) >>> 0;
            j = g; g = f; f = e; e = d + first >>> 0; d = c; c = b; b = a; a = first + second >>> 0;
          }
          const block = [a, b, c, d, e, f, g, j];
          for (let i = 0; i < 8; i++) h[i] += block[i];
        }
        const result = new Uint8Array(32), output = new DataView(result.buffer);
        for (let i = 0; i < 8; i++) output.setUint32(i * 4, h[i]);
        return result;
      }
      function digest(nonce, flags, profile, extended, message) {
        const text = nonce + '|' + flags.join(',') + (extended ?
          '|' + message.m.join(',') + '|' + message.fh.join(',') + '|' + message.u.join(',') : '') + '|' + profile.build;
        const inner = new Uint8Array(64 + text.length), outer = new Uint8Array(96);
        for (let i = 0; i < 64; i++) {
          const byte = i < profile.key.length ? profile.key.charCodeAt(i) & 255 : 0;
          inner[i] = byte ^ 0x36; outer[i] = byte ^ 0x5c;
        }
        for (let i = 0; i < text.length; i++) inner[64 + i] = text.charCodeAt(i) & 255;
        outer.set(sha256(inner), 64);
        return Array.from(sha256(outer), byte => byte.toString(16).padStart(2, '0')).join('');
      }
      const fields = ['t', 'q', 'ts', 'p', 'y', 'pi', 'sn', 'hp', 'h', 'dn', 'dmg', 'i', 'k', 'to', 'hq', 'dx', '_f', 'ph', 'res', 'left', 'by', 'bp', 'hs', 'w', 'v', 'sync', 'ms', 'srv', 'c', 'a', 't0', 'host', 'name', 'look', 'score', 'games', 'wins', 'o', 'd', 'at', 'pt'];
      const types = ['s', 'f', 'h', 'k', 'dead', 'r', 'ready', 'bye', 'back', 'gg', 'lat', 'gb', 'pq', 'pa', 'pr', 'pz', 'dq', 'da', 'dr', 'fin', 'hi', 'fx', 'sb'];
      function wireMap(profile) {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
        let seed = 2166136261;
        for (let i = 0; i < profile.key.length; i++) seed = Math.imul(seed ^ profile.key.charCodeAt(i), 16777619) >>> 0;
        const next = () => {
          seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
          return seed / 4294967296;
        };
        const used = new Set(), ek = new Map(), dk = new Map(), et = new Map(), dt = new Map();
        const token = () => {
          let value;
          do { value = alphabet[Math.floor(24 * next())] + alphabet[Math.floor(47 * next())] + alphabet[Math.floor(47 * next())]; } while (used.has(value));
          used.add(value); return value;
        };
        for (const field of fields) { const value = token(); ek.set(field, value); dk.set(value, field); }
        for (const type of types) { const value = token(); et.set(type, value); dt.set(value, type); }
        return { ek, dk, et, dt };
      }
      const profiles = new Map(profileData.map(profile => [profile.build, { ...profile, mapping: wireMap(profile) }]));
      function mapObject(message, encode, profile) {
        if (!profile || !message || typeof message !== 'object' || Array.isArray(message)) return null;
        const mapping = profile.mapping;
        const result = Object.create(null), keys = encode ? mapping.ek : mapping.dk;
        for (const [name, original] of Object.entries(message)) {
          const field = keys.get(name) || name;
          if (Object.hasOwn(result, field)) return null;
          let value = original;
          if ((encode ? name : field) === 't' && typeof value === 'string') value = (encode ? mapping.et : mapping.dt).get(value) || value;
          result[field] = value;
        }
        return result;
      }
      const recipient = value => typeof value === 'string' && value.length > 0 || Number.isSafeInteger(value);
      function envelope(root, state) {
        const relay = Array.isArray(root);
        if (relay && (!state.room || !state.profile || root.length !== 2 ||
            !(recipient(root[0]) || Array.isArray(root[0]) && root[0].length > 0 && root[0].every(recipient)))) return null;
        const payload = relay ? root[1] : root;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
        const message = state.wire ? mapObject(payload, false, state.profile) : payload;
        return message ? { root, message, relay, encoded: state.wire } : null;
      }
      function endMatch(owner, id, all = false) {
        for (const [token, match] of matches) if (match.owner === owner && (all || match.id === id)) {
          matches.delete(token);
          for (const state of channels.values()) if (state.identity === match) {
            state.identity = null; state.pending.clear();
          }
        }
      }
      function ownMessage(state, message) {
        if (Object.hasOwn(message, '_f')) return state.identity?.mode === '2v2' && message._f === state.identity.pid;
        return state.identity?.mode !== '2v2';
      }
      function challenge(message, profile) {
        const extended = profile.extended && Boolean(message.q || message.f);
        const q = Array.isArray(message.q) ? message.q.slice(0, 200).map(value => String(value)) : [];
        const f = Array.isArray(message.f) ? message.f.slice(0, 8).map(value => String(value)) : [];
        const s = String(message.s || '').slice(0, 32);
        const shape = JSON.stringify([extended, q, f, s,
          Array.isArray(message.q) ? 'array' : Boolean(message.q),
          Array.isArray(message.f) ? 'array' : Boolean(message.f)]);
        return { profile, extended, q, f, s, shape, count: 1, ambiguous: false };
      }
      function validReply(message, pending) {
        if (pending.ambiguous || typeof message.n !== 'string' || !message.n || message.n.length > 32 ||
            !Array.isArray(message.k) || message.k.length > 16 ||
            !message.k.every(value => typeof value === 'string' && value.length <= 512) ||
            typeof message.h !== 'string' || !/^[a-f0-9]{64}$/.test(message.h)) return false;
        if (pending.profile.extended) {
          if (new Set(message.k).size !== message.k.length) return false;
          if (!pending.extended) {
            if (['m', 'fh', 'u'].some(name => Object.hasOwn(message, name))) return false;
          } else {
            if (!Array.isArray(message.m) || message.m.length > 16 ||
                !message.m.every((value, index, values) => Number.isInteger(value) && value >= 0 &&
                  value < pending.q.length && (index === 0 || values[index - 1] < value)) ||
                !Array.isArray(message.fh) || message.fh.length !== pending.f.length ||
                !message.fh.every(value => typeof value === 'string' && /^(?:-|!|[a-f0-9]{16})$/.test(value)) ||
                !Array.isArray(message.u) || message.u.length > 24 ||
                !message.u.every(value => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value)) ||
                new Set(message.u).size !== message.u.length) return false;
          }
        }
        return digest(message.n, message.k, pending.profile, pending.extended, message) === message.h;
      }
      function receive(state, data) {
        if (!active) return;
        const root = parse(data);
        if (!root || Array.isArray(root)) return;
        if (state.pm) {
          if (root.t === 'match' && typeof root.srv?.tok === 'string' && root.srv.tok && recipient(root.me) &&
              (root.mode === '1v1' || root.mode === '2v2') && root.id != null) {
            endMatch(state, null, true);
            if (matches.size >= 16) matches.delete(matches.keys().next().value);
            matches.set(root.srv.tok, { owner: state, id: root.id, pid: root.me, mode: root.mode });
          } else if (root.t === 'result' || root.t === 'foe_absent') endMatch(state, root.match);
          else if (root.t === 'kicked') endMatch(state, null, true);
          return;
        }
        const decoded = envelope(root, state)?.message;
        if (!decoded) return;
        if (state.room && decoded.t === 'in') {
          state.wire = !!state.profile && !!decoded.w;
          return;
        }
        if (!state.room || !state.profile || decoded.t !== 'icq') return;
        let nonce;
        try { nonce = String(decoded.n || '').slice(0, 32); } catch { return; }
        if (!nonce) return;
        let observed;
        try { observed = challenge(decoded, state.profile); }
        catch { observed = { profile: state.profile, ambiguous: true, count: 1 }; }
        const pending = state.pending.get(nonce);
        if (pending) {
          if (observed.ambiguous || pending.profile !== observed.profile ||
              pending.extended !== observed.extended || pending.shape !== observed.shape) pending.ambiguous = true;
          if (pending.count < Number.MAX_SAFE_INTEGER) pending.count++;
          else pending.ambiguous = true;
        } else {
          if (state.pending.size >= 64) state.pending.delete(state.pending.keys().next().value);
          state.pending.set(nonce, observed);
        }
        protocol.challenges++;
      }
      function outgoing(state, data) {
        const root = parse(data);
        if (!root) return { data };
        if (state.pm && root.t === 'leave') return { data, commit() { endMatch(state, root.match); } };
        if (!Array.isArray(root) && root.t === 'join' && typeof root.k === 'string') {
          return { data, commit() {
            reset(state); state.version = typeof root.v === 'string' ? root.v : '';
            const profile = profiles.get(state.version);
            if (root.fx === 1 && profile && root.hb === profile.joinHb) {
              state.room = true; state.profile = profile;
              state.identity = matches.get(root.k) || null;
            }
          } };
        }
        if (state.version && !state.profile) return { data };
        const packet = envelope(root, state);
        if (!packet) return { data };
        const message = packet.message;
        if ((message.t === 'ic' || message.t === 'flag') && ownMessage(state, message)) return { drop: message.t };
        if (message.t !== 'ica' || !ownMessage(state, message)) return { data };
        const pending = state.pending.get(message.n);
        const rejected = () => ({ data, commit() { protocol.rejected++; } });
        if (!pending || pending.profile !== state.profile || !validReply(message, pending)) return rejected();
        let changed = data;
        if (message.k.length) {
          const clean = { ...message, k: [], h: digest(message.n, [], pending.profile, pending.extended, message) };
          const payload = packet.encoded ? mapObject(clean, true, pending.profile) : clean;
          if (!payload) return rejected();
          changed = JSON.stringify(packet.relay ? [root[0], payload] : payload);
        }
        return { data: changed, commit() {
          if (state.pending.get(message.n) === pending && --pending.count <= 0) state.pending.delete(message.n);
          protocol.replies++;
        } };
      }
      function wrap(target, name, make) {
        if (!target || !['object', 'function'].includes(typeof target)) return;
        try {
          let methods = records.get(target);
          const current = target[name], previous = methods?.get(name);
          if (previous?.wrapper === current) return;
          const before = Object.getOwnPropertyDescriptor(target, name);
          if (typeof current !== 'function' || before && (!Object.hasOwn(before, 'value') ||
              !before.writable && !before.configurable) || !before && !Object.isExtensible(target)) return;
          const wrapper = make(current);
          Object.defineProperty(target, name, before ? { ...before, value: wrapper } :
            { value: wrapper, writable: true, configurable: true, enumerable: false });
          if (!methods) records.set(target, methods = new Map());
          methods.set(name, { before, wrapper });
        } catch {}
      }
      function restore(target) {
        const methods = records.get(target);
        if (!methods) return;
        for (const [name, record] of methods) {
          try {
            if (Object.getOwnPropertyDescriptor(target, name)?.value !== record.wrapper) continue;
            if (record.before) Object.defineProperty(target, name, record.before);
            else delete target[name];
          } catch {}
        }
        records.delete(target);
      }
      function parse(data) {
        if (typeof data !== 'string') return null;
        const first = data.trimStart().charCodeAt(0);
        if (first !== 123 && first !== 91) return null;
        try {
          const value = JSON.parse(data);
          return value && typeof value === 'object' ? value : null;
        } catch { return null; }
      }
      function reset(state) {
        state.room = false; state.wire = false; state.version = ''; state.profile = null; state.identity = null; state.pending.clear();
      }
      function detachChannel(channel) {
        const state = channels.get(channel);
        if (!state) return;
        channel.removeEventListener?.('message', state.received);
        channel.removeEventListener?.('open', state.opened);
        channel.removeEventListener?.('close', state.closed);
        state.pending.clear(); channels.delete(channel); restore(channel);
      }
      function attachChannel(channel) {
        if (!active || !channel || typeof channel.send !== 'function') return;
        let state = channels.get(channel);
        if (!state) {
          state = { room: false, wire: false, version: '', profile: null, identity: null, pending: new Map(),
            pm: typeof channel.url === 'string' && /\/pm(?:[?#]|$)/.test(channel.url) };
          state.opened = () => reset(state);
          state.closed = () => detachChannel(channel);
          state.received = event => receive(state, event.data);
          channels.set(channel, state);
          channel.addEventListener?.('message', state.received);
          channel.addEventListener?.('open', state.opened);
          channel.addEventListener?.('close', state.closed);
        }
        wrap(channel, 'send', native => function (data) {
          if (!active || arguments.length === 0) return Reflect.apply(native, this, arguments);
          const owner = channels.get(this);
          if (!owner || this.readyState !== 1 && this.readyState !== 'open') return Reflect.apply(native, this, arguments);
          for (const transform of transforms) data = Reflect.apply(transform, this, [data]);
          const result = outgoing(owner, data);
          if (result.drop) { counts[result.drop]++; return; }
          const args = Array.from(arguments); args[0] = result.data;
          const value = Reflect.apply(native, this, args);
          result.commit?.();
          return value;
        });
      }
      function attachPeer(peer) {
        if (!active || !peer || peers.has(peer)) return;
        const received = event => attachChannel(event.channel);
        peer.addEventListener?.('datachannel', received);
        peers.set(peer, received);
        wrap(peer, 'createDataChannel', native => function (...args) {
          const channel = Reflect.apply(native, this, args);
          attachChannel(channel);
          return channel;
        });
      }
      function constructor(name, attach) {
        wrap(window, name, native => new Proxy(native, {
          construct(target, args, newTarget) {
            const instance = Reflect.construct(target, args, newTarget);
            attach(instance);
            return instance;
          }
        }));
      }
      function telemetry() {
        try { return typeof Telemetry === 'undefined' ? null : Telemetry; } catch { return null; }
      }
      function reconcile() {
        if (!active) return;
        constructor('WebSocket', attachChannel);
        constructor('RTCPeerConnection', attachPeer);
        constructor('webkitRTCPeerConnection', attachPeer);
        const g = window.game;
        for (const channel of [g?.net?.ws, g?.p2pGuest?.ws, g?.p2pHost?.ws, g?.p2pGuest?.link?.dc]) attachChannel(channel);
        const guest = g?.p2pGuest?.link?.pc;
        if (guest) attachPeer(guest);
        if (g?.p2pHost?.peers instanceof Map) for (const peer of g.p2pHost.peers.values()) {
          attachChannel(peer?.link?.dc); attachPeer(peer?.link?.pc);
        }
        const target = telemetry();
        if (target) {
          wrap(target, 'event', native => function (name) {
            if (active && name === 'ac') { counts.ac++; return; }
            return Reflect.apply(native, this, arguments);
          });
          wrap(target, 'packet', native => function (...args) {
            const packet = Reflect.apply(native, this, args);
            if (!active || !Array.isArray(packet?.events)) return packet;
            const events = packet.events.filter(event => event?.type !== 'ac');
            const removed = packet.events.length - events.length;
            if (!removed) return packet;
            counts.ac += removed;
            return { ...packet, events };
          });
        }
        for (const channel of channels.keys()) if (channel.readyState === 3 || channel.readyState === 'closed') detachChannel(channel);
        for (const [peer, listener] of peers) if (peer.connectionState === 'closed') {
          peer.removeEventListener?.('datachannel', listener); peers.delete(peer); restore(peer);
        }
      }
      const api = {
        version: 2,
        get active() { return active; },
        get stats() { return { ...counts }; },
        get protocolStats() { return { ...protocol }; },
        use(transform) {
          if (typeof transform !== 'function') throw new TypeError('Expected a synchronous transport transform');
          transforms.add(transform);
          return () => transforms.delete(transform);
        },
        reconcile,
        dispose() {
          if (!active) return;
          active = false; clearInterval(timer);
          for (const [peer, listener] of peers) peer.removeEventListener?.('datachannel', listener);
          peers.clear(); transforms.clear(); matches.clear();
          for (const channel of channels.keys()) detachChannel(channel);
          for (const target of records.keys()) restore(target);
          if (window.__PE_REPORT_FILTER__ === api) delete window.__PE_REPORT_FILTER__;
        }
      };
      Object.defineProperty(window, '__PE_REPORT_FILTER__', { value: api, configurable: true });
      const timer = setInterval(reconcile, 250);
      reconcile();
    })();
  }

  function stopMoeVianTransport() {
    try {
      window.__PE_REPORT_FILTER__?.dispose?.();
    } catch {}
  }

  function bootGame() {
    let attempts = 0;
    function start() {
      const bridge = window.SolsticeGame;
      if (!bridge) {
        if (attempts++ < 120) setTimeout(start, 25);
        return;
      }
      installGame(bridge);
    }
    start();
  }

  function installGame(bridge) {
    let enabled = true;
    let mode = 'MoeVian';
    let cleanIntegrity = true;
    let blockFlags = true;
    let wsHooked = false;
    let fetchHooked = false;

    function syncModeRuntime() {
      window.__solsticeDisablerActive = Boolean(enabled && (mode === 'MoeVian' || mode === 'Clean Reply'));
      if (enabled && mode === 'MoeVian') {
        startMoeVianTransport();
      } else {
        stopMoeVianTransport();
      }
    }

    syncModeRuntime();

    function sanitizeIntegrityReport(rep) {
      if (!rep || typeof rep !== 'object') return rep;
      const out = { ...rep };
      if (Array.isArray(out.x)) out.x = [];
      if (Array.isArray(out.i)) out.i = [];
      if (Array.isArray(out.findings)) out.findings = [];
      if (Array.isArray(out.hits)) out.hits = [];
      if (Array.isArray(out.flags)) out.flags = [];
      if (Array.isArray(out.marks)) out.marks = [];
      if (Array.isArray(out.detected)) out.detected = [];
      if (typeof out.ok === 'boolean') out.ok = true;
      if (typeof out.clean === 'boolean') out.clean = true;
      return out;
    }

    function sanitizeChallengePayload(msg) {
      if (!msg || typeof msg !== 'object') return msg;
      const out = { ...msg };

      for (const k of ['findings', 'hits', 'flags', 'marks', 'detected', 'x', 'i', 'list', 'items', 'what']) {
        if (Array.isArray(out[k])) {
          out[k] = [];
        }
      }
      if (out.ic && typeof out.ic === 'object') {
        out.ic = sanitizeIntegrityReport(out.ic);
      }
      if (out.report && typeof out.report === 'object') {
        out.report = sanitizeIntegrityReport(out.report);
      }
      if (out.data && typeof out.data === 'object' && !Array.isArray(out.data)) {
        out.data = sanitizeChallengePayload(out.data);
      }
      if (typeof out.ok === 'boolean') out.ok = true;
      if (typeof out.clean === 'boolean') out.clean = true;
      if (typeof out.cheating === 'boolean') out.cheating = false;
      if (typeof out.tampered === 'boolean') out.tampered = false;
      if (typeof out.count === 'number' && out.count > 0 && ('findings' in out || 'hits' in out || 'flags' in out)) {
        out.count = 0;
      }
      return out;
    }

    function processOutgoingString(data) {
      if (!enabled || mode === 'MoeVian' || typeof data !== 'string' || data[0] !== '{' || data.length > 131072) {
        return { drop: false, data };
      }

      const maybeFlag = blockFlags && data.includes('"flag"');
      const maybeIc = data.includes('"ic"') || data.includes('"challenge"') || data.includes('"ic_res"') || data.includes('"icr"');
      const maybeHandshake = cleanIntegrity && (
        data.includes('"queue"') ||
        data.includes('"hello"') ||
        data.includes('"host"') ||
        data.includes('"join"')
      );

      if (!maybeFlag && !maybeIc && !maybeHandshake) {
        return { drop: false, data };
      }

      try {
        const msg = JSON.parse(data);
        if (!msg || typeof msg !== 'object') return { drop: false, data };

        if (blockFlags && msg.t === 'flag') {
          return { drop: true, data };
        }

        if (msg.t === 'ic' || msg.t === 'ic_res' || msg.t === 'icr' || msg.t === 'challenge' || msg.t === 'challenge_res') {
          if (mode === 'Drop') {
            return { drop: true, data };
          }
          const cleaned = sanitizeChallengePayload(msg);
          return { drop: false, data: JSON.stringify(cleaned) + (data.endsWith('\n') ? '\n' : '') };
        }

        if (cleanIntegrity && msg.ic && typeof msg.ic === 'object') {
          const cleaned = { ...msg, ic: sanitizeIntegrityReport(msg.ic) };
          return { drop: false, data: JSON.stringify(cleaned) + (data.endsWith('\n') ? '\n' : '') };
        }
      } catch {}

      return { drop: false, data };
    }

    function installIntegrityHooks() {
      const integ = typeof Integrity !== 'undefined' ? Integrity : window.Integrity;
      if (!integ || typeof integ !== 'object') return;

      if (typeof integ.report === 'function' && !integ.report.__solsticeDisabler) {
        const origReport = integ.report;
        const wrappedReport = async function disablerReport(...args) {
          const res = await origReport.apply(this, args);
          return enabled && cleanIntegrity ? sanitizeIntegrityReport(res) : res;
        };
        Object.defineProperty(wrappedReport, '__solsticeDisabler', { value: true });
        integ.report = wrappedReport;
      }

      if (typeof integ.reportWithin === 'function' && !integ.reportWithin.__solsticeDisabler) {
        const origReportWithin = integ.reportWithin;
        const wrappedReportWithin = async function disablerReportWithin(...args) {
          const res = await origReportWithin.apply(this, args);
          return enabled && cleanIntegrity ? sanitizeIntegrityReport(res) : res;
        };
        Object.defineProperty(wrappedReportWithin, '__solsticeDisabler', { value: true });
        integ.reportWithin = wrappedReportWithin;
      }
    }

    function installTransportHooks() {
      if (!wsHooked && typeof WebSocket === 'function') {
        wsHooked = true;
        const origSend = WebSocket.prototype.send;
        const wrappedSend = function disablerWsSend(data) {
          const res = processOutgoingString(data);
          if (res.drop) return undefined;
          return origSend.call(this, res.data);
        };
        Object.defineProperty(wrappedSend, '__solsticeDisabler', { value: true });
        WebSocket.prototype.send = wrappedSend;
      }

      if (!fetchHooked && typeof window.fetch === 'function') {
        fetchHooked = true;
        const origFetch = window.fetch;
        const wrappedFetch = function disablerFetch(input, init) {
          if (enabled && mode !== 'MoeVian' && init && typeof init.body === 'string') {
            const res = processOutgoingString(init.body);
            if (!res.drop && res.data !== init.body) {
              init = { ...init, body: res.data };
            }
          }
          return origFetch.call(this, input, init);
        };
        Object.defineProperty(wrappedFetch, '__solsticeDisabler', { value: true });
        window.fetch = wrappedFetch;
      }

      const g = window.game;
      for (const peer of [g?.net, g?.p2pGuest]) {
        if (peer && typeof peer.send === 'function' && !peer.send.__solsticeDisabler) {
          const origPeerSend = peer.send;
          const wrappedPeerSend = function disablerPeerSend(msg, ...rest) {
            if (enabled && mode !== 'MoeVian' && blockFlags && msg && typeof msg === 'object' && msg.t === 'flag') {
              return undefined;
            }
            return origPeerSend.call(this, msg, ...rest);
          };
          Object.defineProperty(wrappedPeerSend, '__solsticeDisabler', { value: true });
          peer.send = wrappedPeerSend;
        }
      }
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'disabler') return;
      enabled = Boolean(data.enabled);
      mode = ['MoeVian', 'Clean Reply', 'Drop'].includes(data.mode) ? data.mode : 'MoeVian';
      cleanIntegrity = data.cleanIntegrity !== false;
      blockFlags = data.blockFlags !== false;
      syncModeRuntime();
      installIntegrityHooks();
      installTransportHooks();
    });

    installIntegrityHooks();
    installTransportHooks();
    setInterval(() => {
      installIntegrityHooks();
      installTransportHooks();
    }, 500);
  }
})();
