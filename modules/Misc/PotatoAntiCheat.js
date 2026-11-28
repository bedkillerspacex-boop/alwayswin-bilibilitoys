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
    const now = performance.now();
    const cfg = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(mod.on && ircToken),
      token: ircToken,
      serverUrl: DEFAULT_AC_URL,
      threshold: Math.max(5, Number(setting(mod, 'Alert VL', 20)) || 20),
      ignoreSelf: Boolean(setting(mod, 'Ignore Self', true)),
      ignoreTeammates: Boolean(setting(mod, 'Ignore Teammates', true)),
      autoReport: Boolean(setting(mod, 'AutoReport', false))
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
    document.dispatchEvent(new CustomEvent('solstice:anticheat-flag', {
      detail: {
        message: `[AntiCheat] ${d.name} flagged (${d.reasons.join('/')}, VL ${d.vl.toFixed(1)})`
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
      { t: 'b', n: 'Ignore Self', d: 'Skip cloud anti-cheat checks on your own player.', v: 1 },
      { t: 'b', n: 'Ignore Teammates', d: 'Skip cloud anti-cheat checks on teammates.', v: 1 },
      { t: 'b', n: 'AutoReport', d: 'Automatically report flagged cheaters to the room server.', v: 0 },
      { t: 'n', n: 'Alert VL', d: 'Minimum total VL before flagging a player.', v: 20, min: 5, max: 100, step: 1 }
    ],
    onRender: syncConfig,
    onEnable() {
      if (window.__alwayswinIrcAuthReady && !window.__alwayswinIrcToken) {
        const mod = typeof getMod === 'function' ? getMod('AntiCheat') : null;
        if (mod && typeof setModuleOn === 'function') {
          setTimeout(() => setModuleOn(mod, false), 0);
        }
        document.dispatchEvent(new CustomEvent('solstice:anticheat-flag', {
          detail: { message: '[AntiCheat] 请先登录 IRC 后再启用云端反作弊' }
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
      sniper: 6, ak: 7, shotgun: 8, double: 9, revolver: 10, launcher: 11, melee: 12, illegal: 13
    };

    function normalizeGunKey(raw) {
      if (!raw) return 'unknown';
      const k = String(raw).toLowerCase().trim();
      if (GUN_ID[k] != null) return k;
      if (k === 'double_barrel' || k === 'doublebarrel') return 'double';
      if (k === 'rpg' || k === 'rocket' || k === 'grenade_launcher') return 'launcher';
      if (k.includes('sword') || k.includes('knife') || k.includes('axe') || k.includes('dagger') || k === 'melee') return 'melee';
      if (k.includes('sniper') || k.includes('awp') || k.includes('awm')) return 'sniper';
      if (k.includes('shotgun')) return 'shotgun';
      if (k.includes('revolver')) return 'revolver';
      if (k.includes('pistol')) return 'pistol';
      if (k.includes('smg')) return 'smg';
      if (k.includes('lmg')) return 'lmg';
      if (k.includes('ak')) return 'ak';
      if (k.includes('ar')) return 'ar';
      if (k.includes('rifle')) return 'rifle';
      return 'unknown';
    }

    function fnv1a32(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    }

    function aimErrorDeg(oppPos, oppYaw, oppPitch, myPos) {
      if (!oppPos || !myPos) return 655.35;
      const dx = myPos[0] - oppPos[0];
      const dy = (myPos[1] + 1.5) - (oppPos[1] + 1.5);
      const dz = myPos[2] - oppPos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.01) return 0;
      const fx = -Math.sin(oppYaw) * Math.cos(oppPitch);
      const fy = Math.sin(oppPitch);
      const fz = Math.cos(oppYaw) * Math.cos(oppPitch);
      const dot = Math.max(-1, Math.min(1, (fx * dx + fy * dy + fz * dz) / d));
      return (Math.acos(dot) * 180) / Math.PI;
    }

    class OpponentBatcher {
      constructor(serverUrl, targetKey, mode = 0, roundGunKey = null, options = {}) {
        this.serverUrl = serverUrl.replace(/\/+$/, '');
        this.targetHash = typeof targetKey === 'number' ? (targetKey >>> 0) : fnv1a32(String(targetKey));
        this.mode = mode & 0x07;
        this.roundGunId = roundGunKey ? (GUN_ID[normalizeGunKey(roundGunKey)] ?? 0) : 0;
        this.token = typeof options === 'string' ? options : (options && options.token) || '';
        this.getToken = options && typeof options.getToken === 'function' ? options.getToken : null;
        this.buf = new Uint8Array(2048);
        this.view = new DataView(this.buf.buffer);
        this.offset = 8;
        this.t0 = performance.now();
        this.lastVL = null;
        this.writeHeader();
      }

      setToken(token) {
        this.token = String(token || '');
      }

      setRoundGun(roundGunKey) {
        const nextId = roundGunKey ? (GUN_ID[normalizeGunKey(roundGunKey)] ?? 0) : 0;
        if (nextId === this.roundGunId) return;
        this.roundGunId = nextId;
        this.view.setUint8(3, (this.mode & 0x07) | ((this.roundGunId & 0x1f) << 3));
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
        this.view.setUint8(o + 26, GUN_ID[normalizeGunKey(gunKey)] ?? 0);
        this.offset += 27;
      }

      pushFire(gunKey, oppSpeed, aimErrDegVal) {
        this.ensure(10);
        const o = this.offset;
        this.view.setUint8(o, 0x02);
        this.view.setUint32(o + 1, this.ts(), true);
        this.view.setUint8(o + 5, GUN_ID[normalizeGunKey(gunKey)] ?? 0);
        this.view.setUint16(o + 6, Math.min(65535, Math.round(Math.max(0, oppSpeed || 0) * 100)), true);
        const err = aimErrDegVal == null || !Number.isFinite(aimErrDegVal) ? 65535 : Math.min(65534, Math.round(Math.max(0, aimErrDegVal) * 100));
        this.view.setUint16(o + 8, err, true);
        this.offset += 10;
      }

      pushHit(gunKey, dmg, dist, aimErrDegVal, hitFlags) {
        this.ensure(13);
        const o = this.offset;
        this.view.setUint8(o, 0x03);
        this.view.setUint32(o + 1, this.ts(), true);
        this.view.setUint8(o + 5, GUN_ID[normalizeGunKey(gunKey)] ?? 0);
        this.view.setUint16(o + 6, Math.min(65535, Math.round(Math.max(0, dmg || 0) * 100)), true);
        this.view.setUint16(o + 8, Math.min(65535, Math.round(Math.max(0, dist || 0) * 100)), true);
        const err = aimErrDegVal == null || !Number.isFinite(aimErrDegVal) ? 65535 : Math.min(65534, Math.round(Math.max(0, aimErrDegVal) * 100));
        this.view.setUint16(o + 10, err, true);
        this.view.setUint8(o + 12, hitFlags & 0xff);
        this.offset += 13;
      }

      pushMatchStat(kills, deaths, shots, hits, heads, extValue = 0) {
        this.ensure(17);
        const o = this.offset;
        this.view.setUint8(o, 0x04);
        this.view.setUint32(o + 1, this.ts(), true);
        this.view.setUint16(o + 5, Math.min(65535, kills), true);
        this.view.setUint16(o + 7, Math.min(65535, deaths), true);
        this.view.setUint16(o + 9, Math.min(65535, shots), true);
        this.view.setUint16(o + 11, Math.min(65535, hits), true);
        this.view.setUint16(o + 13, Math.min(65535, heads), true);
        this.view.setUint16(o + 15, Math.min(65535, Math.round(extValue)), true);
        this.offset += 17;
      }

      pushAmbiguousCheat(kind = 0, severityVL = 10) {
        this.ensure(8);
        const o = this.offset;
        this.view.setUint8(o, 0x05);
        this.view.setUint32(o + 1, this.ts(), true);
        this.view.setUint8(o + 5, kind & 0xff);
        this.view.setUint16(o + 6, Math.min(65535, Math.round(severityVL * 10)), true);
        this.offset += 8;
      }

      pushItemDrop(distFromSender, itemCount, totalValue, dropFlags) {
        this.ensure(14);
        const o = this.offset;
        this.view.setUint8(o, 0x06);
        this.view.setUint32(o + 1, this.ts(), true);
        const distCm = distFromSender == null || !Number.isFinite(distFromSender) ? 65535 : Math.min(65534, Math.round(Math.max(0, distFromSender) * 100));
        this.view.setUint16(o + 5, distCm, true);
        this.view.setUint16(o + 7, Math.min(65535, itemCount), true);
        this.view.setUint16(o + 9, Math.min(65535, Math.round(totalValue / 100)), true);
        this.view.setUint8(o + 11, dropFlags & 0xff);
        this.view.setUint16(o + 12, 0, true);
        this.offset += 14;
      }

      pushGodCheck(dealtDmg, oppHp, oppMaxHp = 20) {
        this.ensure(11);
        const o = this.offset;
        this.view.setUint8(o, 0x07);
        this.view.setUint32(o + 1, this.ts(), true);
        this.view.setUint16(o + 5, Math.min(65535, Math.round(Math.max(0, dealtDmg || 0) * 100)), true);
        this.view.setUint16(o + 7, Math.min(65535, Math.round(Math.max(0, oppHp || 0) * 100)), true);
        this.view.setUint16(o + 9, Math.min(65535, Math.round(Math.max(1, oppMaxHp || 20) * 100)), true);
        this.offset += 11;
      }

      pushContainerAct(boxId, dist, aimErrDegVal, actFlags) {
        this.ensure(14);
        const o = this.offset;
        this.view.setUint8(o, 0x08);
        this.view.setUint32(o + 1, this.ts(), true);
        this.view.setUint32(o + 5, typeof boxId === 'number' ? (boxId >>> 0) : fnv1a32(String(boxId)), true);
        const distCm = dist == null || !Number.isFinite(dist) ? 65535 : Math.min(65534, Math.round(Math.max(0, dist) * 100));
        const err = aimErrDegVal == null || !Number.isFinite(aimErrDegVal) ? 65535 : Math.min(65534, Math.round(Math.max(0, aimErrDegVal) * 100));
        this.view.setUint16(o + 9, distCm, true);
        this.view.setUint16(o + 11, err, true);
        this.view.setUint8(o + 13, actFlags & 0xff);
        this.offset += 14;
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
    let ignoreSelf = true;
    let ignoreTeammates = true;
    let autoReport = false;

    const batchers = new Map();
    const matchVl = new Map();
    const flagged = new Map();
    const lastAlertAt = new Map();
    const reportedTargets = new Set();
    const lastPosByKey = new Map();
    const entityKeyMap = new WeakMap();
    const hookedFireFx = new WeakSet();

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
      ignoreSelf = data.ignoreSelf !== false;
      ignoreTeammates = data.ignoreTeammates !== false;
      autoReport = Boolean(data.autoReport);
      if (!enabled) {
        batchers.clear();
        matchVl.clear();
        flagged.clear();
        lastPosByKey.clear();
      }
    });

    bridge.onReset(() => {
      batchers.clear();
      matchVl.clear();
      flagged.clear();
      lastAlertAt.clear();
      reportedTargets.clear();
      lastPosByKey.clear();
    });

    function isInMatch() {
      const g = window.game;
      const xzeR = window.XZE?.R;
      return Boolean(g && g.state === 'play' && !g.ui?.screen && (!xzeR || xzeR.st === 'play'));
    }

    function resolveActorGunKey(actor, rawEntity) {
      if (rawEntity) {
        try {
          if (rawEntity.xzeNet != null) {
            const remote = window.XZE?.R?.net?.remotes?.get?.(rawEntity.xzeNet);
            if (remote?.held) return normalizeGunKey(remote.held);
          }
        } catch {}
        if (rawEntity.peer?.state?.held) return normalizeGunKey(rawEntity.peer.state.held);
        if (typeof rawEntity.held === 'string' && rawEntity.held) return normalizeGunKey(rawEntity.held);
        try {
          const xzKey = typeof window.XZ?.key === 'function' ? window.XZ.key(rawEntity.hand || rawEntity.inv?.held) : null;
          if (xzKey) return normalizeGunKey(xzKey);
        } catch {}
      }
      if (actor?.weapon) return normalizeGunKey(actor.weapon);
      return 'unknown';
    }

    function resolveRoundGunKey() {
      try {
        const duel = window.XZ?.duel;
        if (duel && typeof duel.gun === 'string' && duel.gun) {
          return normalizeGunKey(duel.gun);
        }
      } catch {}
      return null;
    }

    function ensureFireFxHook() {
      const xz = window.XZ;
      if (!xz || typeof xz.fireFx !== 'function' || hookedFireFx.has(xz.fireFx)) return;
      const origFireFx = xz.fireFx;
      const wrappedFireFx = function wrappedPotatoAcFireFx(g, entity, target, gunKey) {
        try {
          if (enabled && activeToken() && isInMatch() && entity && entity !== window.game?.player) {
            const key = entityKeyMap.get(entity);
            const batcher = key ? batchers.get(key) : null;
            if (batcher) {
              const prev = lastPosByKey.get(key);
              const oppSpeed = prev ? prev.speed : 0;
              const myPos = window.game?.player?.pos;
              const oppPos = entity.pos;
              const err = myPos && oppPos
                ? aimErrorDeg(oppPos, Number(entity.yaw) || 0, Number(entity.pitch) || 0, myPos)
                : null;
              batcher.pushFire(gunKey || 'unknown', oppSpeed, err);
            }
          }
        } catch {}
        return origFireFx.apply(this, arguments);
      };
      hookedFireFx.add(wrappedFireFx);
      xz.fireFx = wrappedFireFx;
    }

    function collectTick() {
      if (!enabled || !activeToken() || !isInMatch()) return;
      ensureFireFxHook();

      const gh = bridge.getGH();
      const debug = gh?.debug;
      const player = debug?.player;
      const actors = debug?.match?.actors;
      if (!player || !Array.isArray(actors)) return;

      const mode = window.XZE?.R?.st === 'play' ? 1 : 0;
      const roundGunKey = mode === 0 ? resolveRoundGunKey() : null;
      const now = performance.now();
      const activeKeys = new Set();

      for (const actor of actors) {
        if (!actor || !actor.pos || actor.isBot) continue;
        const rawEntity = actor._entity;
        const duel = window.XZ?.duel;
        const isLadderHuman = Boolean(
          rawEntity &&
          rawEntity.xzDuel === true &&
          rawEntity.remote === true &&
          !duel?.ai &&
          !(Array.isArray(duel?.bots) && duel.bots.some((b) => b && b.e === rawEntity))
        );
        if (rawEntity && !rawEntity.peer && !rawEntity.xzeNet && !isLadderHuman) continue;
        const isSelf = actor === player || (actor.id != null && player.id != null && String(actor.id) === String(player.id));
        if (ignoreSelf && isSelf) continue;
        if (ignoreTeammates && !isSelf && actor.team != null && player.team != null && Number(actor.team) === Number(player.team)) continue;
        const key = String(actor.id ?? actor.name ?? '');
        if (!key) continue;
        activeKeys.add(key);
        if (rawEntity) entityKeyMap.set(rawEntity, key);

        let batcher = batchers.get(key);
        if (!batcher) {
          batcher = new OpponentBatcher(serverUrl, key, mode, roundGunKey, { getToken: activeToken });
          batchers.set(key, batcher);
        } else if (roundGunKey) {
          batcher.setRoundGun(roundGunKey);
        }

        const x = Number(actor.pos.x) || 0;
        const y = Number(actor.pos.y) || 0;
        const z = Number(actor.pos.z) || 0;
        const prev = lastPosByKey.get(key);
        let speed = 0;
        if (prev && now > prev.at) {
          const dtSec = Math.max(0.01, (now - prev.at) / 1000);
          speed = Math.hypot(x - prev.x, z - prev.z) / dtSec;
        }
        lastPosByKey.set(key, { x, y, z, at: now, speed });

        const dead = actor.alive === false || Boolean(rawEntity?.dead);
        const grounded = rawEntity && typeof rawEntity.onGround === 'boolean' ? rawEntity.onGround : actor.grounded !== false;
        const creative = Boolean(rawEntity?.creative || rawEntity?.mode === 1 || rawEntity?.gamemode === 1);
        const flying = Boolean(!dead && !grounded && rawEntity?.flying);

        let flags = 0;
        if (!dead && (actor.crouch || actor.sneak || rawEntity?.sneaking)) flags |= 1 << 0;
        if (grounded) flags |= 1 << 1;
        if (dead) flags |= 1 << 2;
        if (!dead && (actor.ads || rawEntity?.ads)) flags |= 1 << 3;
        if (creative) flags |= 1 << 4;
        if (flying) flags |= 1 << 5;

        batcher.pushState(
          x,
          y,
          z,
          Number(actor.yaw) || 0,
          Number(actor.pitch) || 0,
          flags,
          resolveActorGunKey(actor, rawEntity)
        );
      }

      for (const key of batchers.keys()) {
        if (!activeKeys.has(key)) {
          batchers.delete(key);
          lastPosByKey.delete(key);
        }
      }
    }

    async function flushTick() {
      if (!enabled || !activeToken() || !isInMatch()) return;
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
        if (!vl || vl.totalVL <= 0) continue;

        const totalAccumVl = Math.round(Math.max(matchVl.get(key) || 0, vl.totalVL) * 10) / 10;
        matchVl.set(key, totalAccumVl);
        if (totalAccumVl < alertThreshold) continue;

        const reasons = [];
        if (vl.derp >= 5) reasons.push('Derp');
        if (vl.aim >= 5) reasons.push('Aim');
        if (vl.preaim >= 5) reasons.push('Preaim');
        if (vl.move >= 5) reasons.push('Move');
        if (vl.combat >= 5) reasons.push('Combat');
        if (vl.kd >= 5) reasons.push('KD');
        if (vl.badPackets >= 5) reasons.push('BadPkt');
        if (vl.badMode >= 5) reasons.push('BadMode');
        if (reasons.length === 0) reasons.push('CloudVL');

        const info = { vl: totalAccumVl, reasons, updatedAt: Date.now() };
        flagged.set(key, info);

        if (autoReport && !reportedTargets.has(key)) {
          const targetName = nameByKey.get(key) || '';
          const g = window.game;
          const room = g?.net?.room;
          const actorObj = actors.find((a) => a && String(a.id ?? a.name ?? '') === key);
          const irc = typeof bridge.getFeature === 'function' ? bridge.getFeature('irc') : null;
          const isIrc = actorObj && irc && typeof irc.isIrcUser === 'function' && irc.isIrcUser(actorObj);
          if (
            targetName &&
            !isIrc &&
            room &&
            room.code &&
            g?.net?.name &&
            targetName !== g.net.name &&
            typeof RoomService !== 'undefined' &&
            typeof RoomService.api === 'function' &&
            typeof RoomService.key === 'function'
          ) {
            reportedTargets.add(key);
            RoomService.api('/api/rooms/' + room.code + '/report', {
              key: RoomService.key(),
              from: g.net.name,
              target: targetName,
              reason: 'cheat',
              text: `PotatoAC: ${reasons.join('/')} (VL ${totalAccumVl.toFixed(1)})`
            }).catch(() => {});
          }
        }

        const now = Date.now();
        if (now - (lastAlertAt.get(key) || 0) > 10000) {
          lastAlertAt.set(key, now);
          try {
            window.parent.postMessage({
              channel: NOTIFY_CHANNEL,
              type: 'flag',
              id: key,
              name: nameByKey.get(key) || key,
              vl: totalAccumVl,
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
        },
        getBatcher: (key) => batchers.get(String(key || '')) || null
      });
    }

    setInterval(collectTick, 50);
    setInterval(flushTick, 500);
  }
})();
