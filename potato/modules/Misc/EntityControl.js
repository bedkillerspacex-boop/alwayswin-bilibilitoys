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
    const mod = getMod('EntityControl');
    if (!mod) return;

    const modeSetting = mod.settings.find((s) => s.n === 'Mode');
    const mode = modeSetting?.vals?.[modeSetting.v] || 'Freeze All';
    const flyHeight = Math.max(-30, Math.min(120, Number(setting(mod, 'Fly Height', 30)) || 30));
    const clearBtn = mod.settings.find((s) => s.n === 'Clear');
    let clearSeq = mod.__clearSeq || 0;
    if (clearBtn && clearBtn.v) {
      clearBtn.v = 0;
      clearBtn.bs = 0;
      clearSeq += 1;
      mod.__clearSeq = clearSeq;
      force = true;
    }

    mod.disp = mode;

    const now = performance.now();
    const payload = {
      channel: CHANNEL,
      type: 'config',
      module: 'entitycontrol',
      enabled: Boolean(mod.on),
      mode,
      flyHeight,
      clearSeq
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
    name: 'EntityControl',
    desc: 'Freeze or lift all entities or the crosshair target (also exposes window.CTL).',
    cat: 'Misc',
    nm: { l: 'entitycontrol', ls: 'entity control', n: 'EntityControl', ns: 'Entity Control' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'Choose Freeze All, Fly All, Freeze Target, or Fly Target.', v: 0, vals: ['Freeze All', 'Fly All', 'Freeze Target', 'Fly Target'] },
      { t: 'n', n: 'Fly Height', d: 'Vertical offset in blocks for Fly All / Fly Target.', v: 30, min: -30, max: 120, step: 1 },
      { t: 'b', n: 'Clear', d: 'Click to release all frozen/lifted entities and clear snapshots.', v: 0 }
    ],
    onRender: () => syncConfig(false),
    defaultOn: false,
    onEnable() {
      lastSentAt = 0;
      syncConfig(true);
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
    const SYNC_POS = ['prev', 'lastPos', 'lerpPos', 'renderPos', 'interpPos', 'oldPos', 'smoothPos', 'realPos'];
    const ZERO_VEL = ['vel', 'velocity', 'motion', 'moveVel', 'delta'];

    // mode: 'off' | 'freeze' | 'fly' | 'one_freeze' | 'one_fly'
    let ctlMode = 'off';
    let flyHeight = 30;
    let lastClearSeq = 0;
    let snap = new Map();
    let oneTarget = null;
    let seq = 0;

    function findGame() {
      const candidates = [window.game, window.GAME, window.POTATO?.game, window.Potato?.game];
      for (const g of candidates) {
        if (g && g.player && g.entities) return g;
      }
      return null;
    }

    function keyOf(e) {
      if (e.p2pId != null) return 'p' + e.p2pId;
      if (e.xzeNet != null) return 'x' + e.xzeNet;
      if (e.id != null) return 'i' + e.id;
      if (e.name) return 'n' + e.name;
      if (e.__ctlId == null) e.__ctlId = ++seq;
      return 'r' + e.__ctlId;
    }

    function isControllable(g, e) {
      return Boolean(
        e &&
        e !== g.player &&
        !e.dead &&
        e.pos &&
        typeof e.pos.length === 'number' &&
        e.pos.length >= 3 &&
        typeof e.hurt === 'function'
      );
    }

    function findCrosshairTarget(g) {
      if (!g?.player || !Array.isArray(g.entities)) return null;
      const eye = bridge.getEye ? bridge.getEye() : null;
      const ex = eye ? eye.x : Number(g.player.pos?.[0]) || 0;
      const ey = eye ? eye.y : (Number(g.player.pos?.[1]) || 0) + 1.62;
      const ez = eye ? eye.z : Number(g.player.pos?.[2]) || 0;

      const yaw = Number(g.player.yaw) || 0;
      const pitch = Number(g.player.pitch) || 0;
      const cp = Math.cos(pitch);
      const fx = -Math.sin(yaw) * cp;
      const fy = Math.sin(pitch);
      const fz = -Math.cos(yaw) * cp;

      let best = null;
      let bestScore = Infinity;

      for (const e of g.entities) {
        if (!isControllable(g, e)) continue;
        const h = Number(e.h) > 0.2 ? Number(e.h) : 1.8;
        const dx = Number(e.pos[0]) - ex;
        const dy = Number(e.pos[1]) + h * 0.65 - ey;
        const dz = Number(e.pos[2]) - ez;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.05) continue;

        const dot = Math.max(-1, Math.min(1, (dx * fx + dy * fy + dz * fz) / dist));
        const angle = Math.acos(dot);
        if (angle < bestScore) {
          bestScore = angle;
          best = e;
        }
      }
      return best;
    }

    function lockEntity(e, offsetY) {
      const k = keyOf(e);
      if (!snap.has(k)) {
        snap.set(k, [Number(e.pos[0]) || 0, Number(e.pos[1]) || 0, Number(e.pos[2]) || 0]);
      }
      const s = snap.get(k);
      e.pos[0] = s[0];
      e.pos[1] = s[1] + offsetY;
      e.pos[2] = s[2];

      for (let i = 0; i < SYNC_POS.length; i++) {
        const p = e[SYNC_POS[i]];
        if (p && typeof p.length === 'number' && p.length >= 3) {
          p[0] = e.pos[0];
          p[1] = e.pos[1];
          p[2] = e.pos[2];
        }
      }

      for (let i = 0; i < ZERO_VEL.length; i++) {
        const v = e[ZERO_VEL[i]];
        if (v && typeof v.length === 'number' && v.length >= 3) {
          v[0] = 0;
          v[1] = 0;
          v[2] = 0;
        } else if (v && typeof v === 'object') {
          if ('x' in v) v.x = 0;
          if ('y' in v) v.y = 0;
          if ('z' in v) v.z = 0;
        }
      }

      if (typeof e.vx === 'number') e.vx = 0;
      if (typeof e.vy === 'number') e.vy = 0;
      if (typeof e.vz === 'number') e.vz = 0;
      e.onGround = true;
      e.inWater = false;
      e.inLava = false;
      e.flying = false;
      if (typeof e.fallDist === 'number') e.fallDist = 0;
    }

    function apply() {
      if (ctlMode === 'off') return;
      const g = findGame();
      if (!g || !g.player || g.state !== 'play') return;

      const offsetY = (ctlMode === 'fly' || ctlMode === 'one_fly') ? flyHeight : 0;

      if (ctlMode === 'one_freeze' || ctlMode === 'one_fly') {
        if (!oneTarget || !isControllable(g, oneTarget) || !g.entities.includes(oneTarget)) {
          oneTarget = findCrosshairTarget(g);
        }
        if (oneTarget) {
          lockEntity(oneTarget, offsetY);
        }
        return;
      }

      const list = g.entities || [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!isControllable(g, e)) continue;
        lockEntity(e, offsetY);
      }
    }

    function clearAll() {
      ctlMode = 'off';
      oneTarget = null;
      snap.clear();
      return 'cleared';
    }

    function listEntities() {
      const g = findGame();
      if (!g || !g.player || !Array.isArray(g.entities)) return [];
      const px = Number(g.player.pos?.[0]) || 0;
      const py = Number(g.player.pos?.[1]) || 0;
      const pz = Number(g.player.pos?.[2]) || 0;
      const out = [];
      for (const e of g.entities) {
        if (!e || e === g.player || !e.pos) continue;
        const x = Number(e.pos[0]) || 0;
        const y = Number(e.pos[1]) || 0;
        const z = Number(e.pos[2]) || 0;
        out.push({
          id: e.p2pId ?? e.xzeNet ?? e.id ?? null,
          name: e.xzeName || e.peer?.name || e.name || e.type || 'Entity',
          type: e.type || 'unknown',
          dead: Boolean(e.dead),
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
          z: Math.round(z * 100) / 100,
          dist: Math.round(Math.hypot(x - px, y - py, z - pz) * 100) / 100,
          locked: snap.has(keyOf(e))
        });
      }
      return out;
    }

    const hookedSet = new WeakSet();

    function hook() {
      const g = findGame();
      if (!g) return;

      if (g.renderer && typeof g.renderer.setCamera === 'function' && !hookedSet.has(g.renderer.setCamera)) {
        const oc = g.renderer.setCamera;
        const wrappedCam = function setCamera() {
          try { apply(); } catch {}
          return oc.apply(this, arguments);
        };
        Object.defineProperty(wrappedCam, '__solsticeCtlCam', { value: true });
        hookedSet.add(wrappedCam);
        g.renderer.setCamera = wrappedCam;
      }

      if (typeof g.tick === 'function' && !hookedSet.has(g.tick)) {
        const ot = g.tick;
        const wrappedTick = function tick() {
          const r = ot.apply(this, arguments);
          try { apply(); } catch {}
          return r;
        };
        Object.defineProperty(wrappedTick, '__solsticeCtlTick', { value: true });
        hookedSet.add(wrappedTick);
        g.tick = wrappedTick;
      }

      if (typeof g.render === 'function' && !hookedSet.has(g.render)) {
        const orr = g.render;
        const wrappedRender = function render() {
          try { apply(); } catch {}
          return orr.apply(this, arguments);
        };
        Object.defineProperty(wrappedRender, '__solsticeCtlRender', { value: true });
        hookedSet.add(wrappedRender);
        g.render = wrappedRender;
      }
    }

    window.CTL = {
      freeze(on = true) {
        if (!on) return clearAll();
        snap.clear();
        oneTarget = null;
        ctlMode = 'freeze';
        apply();
        return 'freeze all';
      },
      fly(on = true, h = 30) {
        if (!on) return clearAll();
        if (typeof h === 'number' && Number.isFinite(h)) flyHeight = h;
        snap.clear();
        oneTarget = null;
        ctlMode = 'fly';
        apply();
        return `fly all +${flyHeight}`;
      },
      one(doFly = false, h = 30) {
        const g = findGame();
        if (typeof h === 'number' && Number.isFinite(h)) flyHeight = h;
        snap.clear();
        oneTarget = g ? findCrosshairTarget(g) : null;
        ctlMode = doFly ? 'one_fly' : 'one_freeze';
        apply();
        return oneTarget ? `${ctlMode}: ${oneTarget.name || oneTarget.id || 'target'}` : 'no target';
      },
      clear: clearAll,
      list: listEntities
    };

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'entitycontrol') return;

      if (typeof data.flyHeight === 'number' && Number.isFinite(data.flyHeight)) {
        flyHeight = data.flyHeight;
      }

      if (data.clearSeq && data.clearSeq !== lastClearSeq) {
        lastClearSeq = data.clearSeq;
        clearAll();
      }

      if (!data.enabled) {
        if (ctlMode !== 'off') clearAll();
        return;
      }

      const modeMap = {
        'Freeze All': 'freeze',
        'Fly All': 'fly',
        'Freeze Target': 'one_freeze',
        'Fly Target': 'one_fly'
      };
      const nextMode = modeMap[data.mode] || 'freeze';
      if (nextMode !== ctlMode) {
        snap.clear();
        oneTarget = null;
        ctlMode = nextMode;
        apply();
      }
    });

    if (typeof bridge.onReset === 'function') {
      bridge.onReset(() => {
        snap.clear();
        oneTarget = null;
      });
    }

    hook();
    setInterval(() => {
      apply();
      hook();
    }, 16);
  }
})();
