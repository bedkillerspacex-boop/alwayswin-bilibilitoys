(() => {
  'use strict';

  /* PotatoEpic 云端反作弊客户端（对接 alwayswin.firebounce.today/potato-ac，必须登录 IRC 才可使用） */

  const CHANNEL = 'solstice-potato-ac';
  const NOTIFY_CHANNEL = 'solstice-potato-ac-alert';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const OUTER_ORIGIN = 'https://www.bilibili.com';
  const DEFAULT_AC_URL = 'https://alwayswin.firebounce.today/potato-ac';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/potatoepic/')) {
    bootGame();
    return;
  }

  let lastSentKey = '';
  let lastSentAt = 0;
  let lastWarnAt = 0;

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}/toy/potatoepic/`)) {
        return frame;
      }
    }
    return null;
  }

  function setting(mod, name, fallback) {
    const s = mod?.settings?.find((e) => e.n === name);
    return s ? s.v : fallback;
  }

  function syncConfig() {
    const mod = typeof getMod === 'function' ? getMod('AntiCheat') : null;
    if (!mod) return;

    const ircToken = String(window.__alwayswinIrcToken || '');
    if (mod.on && !ircToken) {
      if (typeof setModuleOn === 'function') {
        setModuleOn(mod, false);
      } else {
        mod.on = false;
      }
      const now = Date.now();
      if (now - lastWarnAt > 3000) {
        lastWarnAt = now;
        window.dispatchEvent(new CustomEvent('solstice:notify', {
          detail: { title: 'AntiCheat', text: '请先登录 IRC 后再启用云端反作弊', type: 'warn' }
        }));
      }
      return;
    }

    const now = performance.now();
    const cfg = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(mod.on && ircToken),
      token: ircToken,
      serverUrl: DEFAULT_AC_URL,
      threshold: Math.max(5, Number(setting(mod, 'Alert VL', 20)) || 20)
    };
    const key = JSON.stringify(cfg);
    if (key === lastSentKey && now - lastSentAt < 500) return;

    const frame = findGameFrame();
    if (!frame?.contentWindow) return;

    frame.contentWindow.postMessage(cfg, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN) return;
    const d = event.data;
    if (!d || d.channel !== NOTIFY_CHANNEL || d.type !== 'flag') return;
    window.dispatchEvent(new CustomEvent('solstice:notify', {
      detail: {
        title: 'PotatoAC',
        text: `${d.name} 疑似作弊 (${d.reasons.join('/')}, VL ${d.vl.toFixed(1)})`,
        type: 'warn'
      }
    }));
  });

  register({
    game: 'potatoepic',
    name: 'AntiCheat',
    desc: 'Cloud binary anti-cheat for PotatoEpic (requires IRC login).',
    cat: 'Misc',
    nm: { l: 'anticheat', ls: 'anti cheat', n: 'AntiCheat', ns: 'Anti Cheat' },
    disp: 'Cloud',
    settings: [
      { t: 'n', n: 'Alert VL', d: 'Minimum total VL before flagging a player.', v: 20, min: 5, max: 100, step: 1 }
    ],
    onRender: syncConfig,
    onEnable() {
      if (!window.__alwayswinIrcToken) {
        const mod = typeof getMod === 'function' ? getMod('AntiCheat') : null;
        if (mod && typeof setModuleOn === 'function') {
          setTimeout(() => setModuleOn(mod, false), 0);
        }
        window.dispatchEvent(new CustomEvent('solstice:notify', {
          detail: { title: 'AntiCheat', text: '请先登录 IRC 后再启用云端反作弊', type: 'warn' }
        }));
      }
    }
  });

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
    const GUN_ID = {
      unknown: 0, rifle: 1, pistol: 2, smg: 3, ar: 4, lmg: 5,
      sniper: 6, ak: 7, shotgun: 8, double: 9, revolver: 10, launcher: 11, melee: 12
    };

    function fnv1a32(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    }

    class OpponentBatcher {
      constructor(serverUrl, targetKey, mode = 0, roundGunKey = null, options = {}) {
        this.serverUrl = serverUrl.replace(/\/+$/, '');
        this.targetHash = typeof targetKey === 'number' ? (targetKey >>> 0) : fnv1a32(String(targetKey));
        this.mode = mode & 0x07;
        this.roundGunId = roundGunKey ? (GUN_ID[roundGunKey] ?? 0) : 0;
        this.token = (options && options.token) || '';
        this.getToken = options && typeof options.getToken === 'function' ? options.getToken : null;
        this.buf = new Uint8Array(2048);
        this.view = new DataView(this.buf.buffer);
        this.offset = 8;
        this.t0 = performance.now();
        this.lastVL = null;
        this.writeHeader();
      }

      writeHeader() {
        this.view.setUint16(0, 0x4550, true);
        this.view.setUint8(2, 1);
        this.view.setUint8(3, (this.mode & 0x07) | ((this.roundGunId & 0x1f) << 3));
        this.view.setUint32(4, this.targetHash, true);
        this.offset = 8;
      }

      ensure(bytes) {
        if (this.offset + bytes > this.buf.length) {
          this.flush();
        }
      }

      ts() {
        return (performance.now() - this.t0) >>> 0;
      }

      pushState(x, y, z, yaw, pitch, flags, gunKey) {
        this.ensure(27);
        const o = this.offset;
        this.view.setUint8(o, 0x01);
        this.view.setUint32(o + 1, this.ts(), true);
        this.view.setFloat32(o + 5, x, true);
        this.view.setFloat32(o + 9, y, true);
        this.view.setFloat32(o + 13, z, true);
        this.view.setFloat32(o + 17, yaw, true);
        this.view.setFloat32(o + 21, pitch, true);
        this.view.setUint8(o + 25, flags & 0xff);
        this.view.setUint8(o + 26, GUN_ID[gunKey] ?? 0);
        this.offset += 27;
      }

      async flush() {
        if (this.offset <= 8) return this.lastVL;
        const tok = this.getToken ? String(this.getToken() || '') : this.token;
        if (!tok) return this.lastVL;
        const payload = this.buf.slice(0, this.offset);
        this.writeHeader();
        try {
          const res = await fetch(`${this.serverUrl}/v1/ingest`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              Authorization: `Bearer ${tok}`
            },
            body: payload
          });
          if (!res.ok) return this.lastVL;
          const ab = await res.arrayBuffer();
          this.lastVL = OpponentBatcher.decodeVL(ab);
          return this.lastVL;
        } catch {
          return this.lastVL;
        }
      }

      static decodeVL(ab) {
        if (!ab || ab.byteLength < 16) return null;
        const v = new DataView(ab);
        if (v.getUint16(0, true) !== 0x4C56) return null;
        const mask = v.getUint16(14, true);
        let o = 16;
        const readIf = (bit) => {
          if ((mask & (1 << bit)) === 0 || o + 2 > ab.byteLength) return 0;
          const val = v.getUint16(o, true) / 10;
          o += 2;
          return val;
        };
        return {
          mode: v.getUint8(3),
          targetHash: v.getUint32(4, true),
          totalVL: v.getUint16(8, true) / 10,
          samples: v.getUint32(10, true),
          derp: readIf(0),
          aim: readIf(1),
          preaim: readIf(2),
          move: readIf(3),
          combat: readIf(4),
          kd: readIf(5),
          ambiguousVL: readIf(6),
          badPackets: readIf(7),
          badMode: readIf(8)
        };
      }
    }

    let enabled = false;
    let ircToken = '';
    let serverUrl = DEFAULT_AC_URL;
    let alertThreshold = 20;

    const batchers = new Map();
    const flagged = new Map();
    const lastAlertAt = new Map();

    function activeToken() {
      const irc = typeof bridge.getFeature === 'function' ? bridge.getFeature('irc') : null;
      return String(irc?.getToken?.() || ircToken || window.__alwayswinIrcToken || '');
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') return;
      enabled = Boolean(data.enabled);
      ircToken = String(data.token || '');
      serverUrl = String(data.serverUrl || DEFAULT_AC_URL).replace(/\/+$/, '');
      alertThreshold = Math.max(5, Number(data.threshold) || 20);
      if (!enabled) {
        batchers.clear();
        flagged.clear();
      }
    });

    bridge.onReset(() => {
      batchers.clear();
      flagged.clear();
      lastAlertAt.clear();
    });

    function collectTick() {
      if (!enabled || !activeToken()) return;
      const gh = bridge.getGH();
      const debug = gh?.debug;
      const player = debug?.player;
      const actors = debug?.match?.actors;
      if (!player || !Array.isArray(actors)) return;

      const mode = window.XZE ? 1 : 0;
      for (const actor of actors) {
        if (!actor || actor === player || !actor.pos) continue;
        if (actor.team != null && player.team != null && Number(actor.team) === Number(player.team)) continue;
        const key = String(actor.id ?? actor.name ?? '');
        if (!key) continue;

        let batcher = batchers.get(key);
        if (!batcher) {
          batcher = new OpponentBatcher(serverUrl, key, mode, null, { getToken: activeToken });
          batchers.set(key, batcher);
        }

        let flags = 0;
        if (actor.crouch || actor.sneak) flags |= 1 << 0;
        if (actor.grounded !== false) flags |= 1 << 1;
        if (actor.alive === false) flags |= 1 << 2;
        if (actor.ads) flags |= 1 << 3;

        batcher.pushState(
          Number(actor.pos.x) || 0,
          Number(actor.pos.y) || 0,
          Number(actor.pos.z) || 0,
          Number(actor.yaw) || 0,
          Number(actor.pitch) || 0,
          flags,
          String(actor.weapon || 'unknown').toLowerCase()
        );
      }
    }

    async function flushTick() {
      if (!enabled || !activeToken()) return;
      const gh = bridge.getGH();
      const actors = gh?.debug?.match?.actors || [];
      const nameByKey = new Map();
      for (const a of actors) {
        if (a && (a.id != null || a.name)) {
          nameByKey.set(String(a.id ?? a.name), String(a.name || a.id || 'Player'));
        }
      }

      for (const [key, batcher] of batchers) {
        const vl = await batcher.flush();
        if (!vl || vl.totalVL < alertThreshold) continue;

        const reasons = [];
        if (vl.derp >= 5) reasons.push('Derp');
        if (vl.aim >= 5) reasons.push('Aim');
        if (vl.preaim >= 5) reasons.push('Preaim');
        if (vl.move >= 5) reasons.push('Move');
        if (vl.combat >= 5) reasons.push('Combat');
        if (vl.badPackets >= 5) reasons.push('BadPkt');
        if (vl.badMode >= 5) reasons.push('BadMode');
        if (reasons.length === 0) reasons.push('CloudVL');

        const info = { vl: vl.totalVL, reasons, updatedAt: Date.now() };
        flagged.set(key, info);

        const now = Date.now();
        if (now - (lastAlertAt.get(key) || 0) > 10000) {
          lastAlertAt.set(key, now);
          try {
            window.parent.postMessage({
              channel: NOTIFY_CHANNEL,
              type: 'flag',
              id: key,
              name: nameByKey.get(key) || key,
              vl: vl.totalVL,
              reasons
            }, OUTER_ORIGIN);
          } catch {}
        }
      }
    }

    if (typeof bridge.provide === 'function') {
      bridge.provide('anticheat', {
        getInfo: (actor) => {
          if (!actor) return null;
          return flagged.get(String(actor.id ?? actor.name ?? '')) || null;
        },
        isCheater: (actor) => {
          if (!actor) return false;
          return flagged.has(String(actor.id ?? actor.name ?? ''));
        }
      });
    }

    setInterval(collectTick, 50);
    setInterval(flushTick, 500);
  }
})();
