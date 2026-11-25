(() => {
  'use strict';

  const CHANNEL = 'solstice-anticheat';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const OUTER_ORIGIN = 'https://www.bilibili.com';
  const MIN_SEND_INTERVAL_MS = 100;
  const HEARTBEAT_MS = 500;
  const AUDIO_FILES = {
    Cash: 'cash.wav',
    Windows: 'windows_background.wav',
    Mario: 'mariodeath.wav',
    Fard: 'fard.wav'
  };
  let audioCtx = null;

  function playFlagSound(mode, volume) {
    const vol = Math.max(0, Math.min(1, Number(volume) || 0));

    if (vol <= 0) {
      return;
    }

    const file = AUDIO_FILES[mode];

    if (file) {
      const base = document.documentElement?.getAttribute('data-solstice-audio-base');

      if (base) {
        const audio = new Audio(`${base}${file}`);
        audio.volume = vol;
        audio.play().catch(() => {});
        return;
      }
    }

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;

      if (!Ctx) {
        return;
      }

      if (!audioCtx) {
        audioCtx = new Ctx();
      }

      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      const now = audioCtx.currentTime;
      const notes = mode === 'Chime' ? [880, 1318.5] : [660, 880];

      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const start = now + idx * 0.09;
        osc.type = mode === 'Chime' ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.01, vol * 0.35), start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.17);
      });
    } catch {

    }
  }

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  let lastSentKey = '';
  let lastSentAt = 0;

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}/toy/golden-hour/`)) {
        return frame;
      }
    }

    return null;
  }

  function setting(module, name, fallback) {
    const entry = module.settings.find((s) => s.n === name);
    return entry ? entry.v : fallback;
  }

  function syncConfig() {
    const module = getMod('AntiCheat');

    if (!module) {
      return;
    }

    const now = performance.now();

    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      return;
    }

    const config = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(module.on),
      spinDerp: Boolean(setting(module, 'Spin / Derp', true)),
      bhopSpeed: Boolean(setting(module, 'Bhop Speed', true)),
      noJumpDelay: Boolean(setting(module, 'NoJumpDelay', true)),
      highHeadshot: Boolean(setting(module, 'High Headshot', true)),
      silentAim: Boolean(setting(module, 'Silent Aim', true)),
      perfectShoot: Boolean(setting(module, 'Perfect Shoot', true)),
      smoothAim: Boolean(setting(module, 'Smooth Aim', true)),
      rotationSnap: Boolean(setting(module, 'Rotation Snap', true)),
      aimPrecision: Boolean(setting(module, 'Aim Precision', true)),
      flagVl: Math.max(3, Math.min(20, Number(setting(module, 'Flag VL', 6.0)) || 6.0)),
      notify: Boolean(setting(module, 'Notify', true)),
      ignoreSelf: Boolean(setting(module, 'Ignore Self', true)),
      ignoreIrc: Boolean(setting(module, 'Ignore IRC', true))
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

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN || event.data?.channel !== CHANNEL || event.data.type !== 'flag') {
      return;
    }

    const frame = findGameFrame();

    if (!frame || event.source !== frame.contentWindow) {
      return;
    }

    const module = getMod('AntiCheat');

    if (!module?.on) {
      return;
    }

    if (setting(module, 'Flag Sound', true)) {
      const modeSetting = module.settings.find((entry) => entry.n === 'Sound Mode');
      const mode = modeSetting?.vals?.[modeSetting.v] || 'Alert';
      const volume = setting(module, 'Sound Volume', 0.8);
      playFlagSound(mode, volume);
    }

    if (!setting(module, 'Notify', true)) {
      return;
    }

    const name = String(event.data.name || 'Unknown');
    const reasons = Array.isArray(event.data.reasons) ? event.data.reasons.filter(Boolean) : [];
    const reasonText = reasons.length ? reasons.join(', ') : 'Suspicious';

    try {
      document.dispatchEvent(new CustomEvent('solstice:anticheat-flag', {
        detail: { message: `[AntiCheat] ${name} flagged (${reasonText})` }
      }));
    } catch {

    }
  });

  register({
    name: 'AntiCheat',
    desc: 'Flags cheaters (Spin/Derp, Bhop Speed, NoJumpDelay, High Headshot, Silent Aim).',
    cat: 'Misc',
    nm: { l: 'anticheat', ls: 'anti cheat', n: 'AntiCheat', ns: 'Anti Cheat' },
    disp: '',
    settings: [
      { t: 'b', n: 'Spin / Derp', d: 'Flag abnormal yaw spin or pitch spoofing.', v: 1 },
      { t: 'b', n: 'Bhop Speed', d: 'Flag impossible horizontal speed or sustained speedhop.', v: 1 },
      { t: 'b', n: 'NoJumpDelay', d: 'Flag consecutive zero-delay bunnyhops.', v: 1 },
      { t: 'b', n: 'High Headshot', d: 'Flag rapid consecutive headshot chains (VL decay).', v: 1 },
      { t: 'b', n: 'Silent Aim', d: 'Flag shots fired far outside the player view angle.', v: 1 },
      { t: 'b', n: 'Perfect Shoot', d: 'Flag instant kills the moment an enemy exposes from cover.', v: 1 },
      { t: 'b', n: 'Smooth Aim', d: 'Flag robotic smooth aiming (Run, Curve, Exponential convergence).', v: 1 },
      { t: 'b', n: 'Rotation Snap', d: 'Flag silent flick snaps and abnormal fast-turn headshots.', v: 1 },
      { t: 'b', n: 'Aim Precision', d: 'Flag inhuman angular precision and zero-variance lock.', v: 1 },
      { t: 'n', n: 'Flag VL', d: 'VL threshold required to flag and notify.', v: 6.0, min: 3.0, max: 20.0, step: 0.5 },
      { t: 'b', n: 'Notify', d: 'Show a notification when a cheater is flagged.', v: 1 },
      { t: 'b', n: 'Flag Sound', d: 'Play a sound when a cheater is flagged.', v: 1 },
      { t: 'e', n: 'Sound Mode', d: 'The alert sound played when a cheater is flagged.', v: 0, vals: ['Alert', 'Chime', 'Cash', 'Windows', 'Mario', 'Fard'] },
      { t: 'n', n: 'Sound Volume', d: 'The volume of the alert sound.', v: 0.8, min: 0, max: 1, step: 0.1 },
      { t: 'b', n: 'Ignore Self', d: 'Skip anti-cheat checks on your own player.', v: 1 },
      { t: 'b', n: 'Ignore IRC', d: 'Skip anti-cheat checks on IRC users.', v: 1 }
    ],
    onRender: syncConfig,
    onEnable() {
      syncConfig();
    }
  });

  setInterval(syncConfig, 250);

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
    let config = {
      enabled: false,
      spinDerp: true,
      bhopSpeed: true,
      noJumpDelay: true,
      highHeadshot: true,
      silentAim: true,
      perfectShoot: true,
      smoothAim: true,
      rotationSnap: true,
      aimPrecision: true,
      flagVl: 6.0,
      notify: true,
      ignoreSelf: true,
      ignoreIrc: true
    };

    const records = new Map();
    const latestSnapById = new Map();
    const snapHistoryById = new Map();
    let lastSnapTick = -1;

    function wrapAngle(angle) {
      let a = angle;

      while (a > Math.PI) {
        a -= Math.PI * 2;
      }

      while (a < -Math.PI) {
        a += Math.PI * 2;
      }

      return a;
    }

    function getRecord(id, name) {
      const key = String(id);
      let rec = records.get(key);

      if (!rec) {
        rec = {
          id: key,
          name: name || `Player ${key}`,
          flags: new Set(),
          prevAt: 0,
          prevYaw: null,
          prevPitch: null,
          accumYaw: 0,
          yawDir: 0,
          spinTime: 0,
          pitchFlips: 0,
          lastPitchDir: 0,
          lastPitchFlipAt: 0,
          highSpeedStreak: 0,
          speedSamples: [],
          fastLandings: [],
          wasGround: null,
          landedAt: 0,
          landedFromFall: false,
          prevVy: 0,
          instantHops: 0,
          lastHopAt: 0,
          vlUpdatedAt: 0,
          spinVl: 0,
          speedVl: 0,
          jumpVl: 0,
          hsVl: 0,
          silentVl: 0,
          perfectShootVl: 0,
          smoothAimVl: 0,
          snapVl: 0,
          aimPrecisionVl: 0,
          lastHeadAt: 0,
          lastHeadKillAt: 0,
          headStreak: 0,
          lastShotgunBurstAt: 0,
          angSamples: [],
          smoothTrackAt: 0,
          samples: [],
          lastBigTurnAt: 0,
          lastBigTurnDeg: 0,
          lastShotEvent: null,
          flickAttempts: 0,
          flickHits: 0,
          flickMisses: 0,
          pendingFlickShots: [],
          precSamples: [],
          precEvalCount: 0,
          yokaiSmooth: {
            hist: [],
            run: 0,
            runStartT: 0,
            lastRun: null,
            curveHist: [],
            curveSign: 0,
            curveRun: 0,
            curveStartT: 0,
            lastCurve: null,
            exp: {
              mode: 0,
              signY: 0,
              signP: 0,
              prevDy: 0,
              prevDp: 0,
              startT: 0,
              samples: 0,
              total: 0,
              ratiosY: [],
              ratiosP: [],
              flagged: false,
              last: null
            }
          }
        };
        records.set(key, rec);
      } else if (name) {
        rec.name = name;
      }

      return rec;
    }

    function resolveActorName(id) {
      const actors = bridge.getGH()?.debug?.match?.actors;

      if (Array.isArray(actors)) {
        const found = actors.find((actor) => actor && String(actor.id) === String(id));

        if (found?.name) {
          return String(found.name);
        }
      }

      return `Player ${id}`;
    }

    function isIrcIgnored(id) {
      if (!config.ignoreIrc || id == null) {
        return false;
      }

      const irc = typeof bridge.getFeature === 'function' ? bridge.getFeature('irc') : null;
      return Boolean(irc && typeof irc.isIrcUser === 'function' && irc.isIrcUser({ id }));
    }

    function flagPlayer(rec, reason) {
      if (!reason || rec.flags.has(reason)) {
        return;
      }

      rec.flags.add(reason);

      if (config.notify) {
        try {
          window.parent.postMessage({
            channel: CHANNEL,
            type: 'flag',
            id: rec.id,
            name: rec.name,
            reasons: Array.from(rec.flags)
          }, OUTER_ORIGIN);
        } catch {

        }
      }
    }

    const VL_DECAY_RATES = {
      spinVl: 1.2,
      speedVl: 0.8,
      jumpVl: 0.7,
      hsVl: 0.85,
      silentVl: 0.5,
      perfectShootVl: 0.35,
      smoothAimVl: 0.35,
      snapVl: 0.45,
      aimPrecisionVl: 0.35
    };

    function decayAllVl(rec, now) {
      if (rec.vlUpdatedAt > 0) {
        const dt = Math.max(0, (now - rec.vlUpdatedAt) / 1000);

        if (dt > 0) {
          for (const [field, rate] of Object.entries(VL_DECAY_RATES)) {
            if (rec[field] > 0) {
              rec[field] = Math.max(0, rec[field] - dt * rate);
            }
          }
        }
      }

      rec.vlUpdatedAt = now;
    }

    function addVl(rec, field, delta, threshold, reason, now) {
      decayAllVl(rec, now);
      rec[field] = Math.max(0, (rec[field] || 0) + delta);
      const effectiveThreshold = Math.max(threshold, config.flagVl || 6.0);

      if (rec[field] >= effectiveThreshold) {
        flagPlayer(rec, reason);
      }
    }

    function checkSpinDerp(rec, p, now) {
      if (!config.spinDerp) {
        return;
      }

      if (Math.abs(p.pitch) > 1.58) {
        addVl(rec, 'spinVl', 6.0, 6.0, 'Derp', now);
      }

      if (rec.prevYaw !== null && rec.prevAt > 0) {
        const dt = Math.max(0.001, (now - rec.prevAt) / 1000);

        if (dt <= 0.25) {
          const dyaw = wrapAngle(p.yaw - rec.prevYaw);

          if (Math.abs(dyaw) > 0.06) {
            const dir = Math.sign(dyaw);

            if (rec.yawDir === 0 || rec.yawDir === dir) {
              rec.yawDir = dir;
              rec.accumYaw += dyaw;
              rec.spinTime += dt;
            } else {
              rec.yawDir = dir;
              rec.accumYaw = dyaw;
              rec.spinTime = dt;
            }

            if (rec.spinTime >= 0.45 && Math.abs(rec.accumYaw) >= Math.PI * 2.2) {
              addVl(rec, 'spinVl', 3.2, 6.0, 'Spin', now);
            }
          } else {
            rec.accumYaw = 0;
            rec.yawDir = 0;
            rec.spinTime = 0;
          }

          const dpitch = p.pitch - rec.prevPitch;

          if (Math.abs(dpitch) > 1.35) {
            const pdir = Math.sign(dpitch);

            if (rec.lastPitchDir !== 0 && rec.lastPitchDir !== pdir) {
              rec.pitchFlips++;
              rec.lastPitchFlipAt = now;

              if (rec.pitchFlips >= 2) {
                addVl(rec, 'spinVl', 2.4, 6.0, 'Derp', now);
              }
            }

            rec.lastPitchDir = pdir;
          }
        } else {
          rec.accumYaw = 0;
          rec.yawDir = 0;
          rec.spinTime = 0;
        }
      }

      if (rec.pitchFlips > 0 && now - rec.lastPitchFlipAt > 1500) {
        rec.pitchFlips = 0;
      }
    }

    const RAD2DEG = 180 / Math.PI;
    const WEAPON_EXTRA_TOLERANCE_DEG = { ar: 1.5, smg: 1.0, shotgun: 8.0, pistol: 1.5 };

    function wrapDeg(delta) {
      let d = (delta + 180) % 360;
      if (d < 0) d += 360;
      return d - 180;
    }

    function signChanges(values) {
      let changes = 0;
      let prev = 0;
      for (const value of values) {
        if (Math.abs(value) <= 1e-6) continue;
        const sign = Math.sign(value);
        if (prev && sign !== prev) changes++;
        prev = sign;
      }
      return changes;
    }

    function dirOf(yaw, pitch) {
      const cp = Math.cos(pitch);
      return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    }

    function angleDeg(yawA, pitchA, yawB, pitchB) {
      const a = dirOf(yawA, pitchA);
      const b = dirOf(yawB, pitchB);
      const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      return Math.acos(dot) * RAD2DEG;
    }

    function shotPrecisionDeg(origin, dir, point) {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const dz = point.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      const dirLen = Math.hypot(dir.x, dir.y, dir.z);
      if (dist < 1e-4 || dirLen < 1e-4) return null;
      const dot = Math.max(-1, Math.min(1, (dx * dir.x + dy * dir.y + dz * dir.z) / (dist * dirLen)));
      return Math.acos(dot) * RAD2DEG;
    }

    function resetYokaiSmooth(rec) {
      const s = rec.yokaiSmooth;
      s.hist.length = 0;
      s.run = 0;
      s.runStartT = 0;
      s.lastRun = null;
      s.curveHist.length = 0;
      s.curveSign = 0;
      s.curveRun = 0;
      s.curveStartT = 0;
      s.lastCurve = null;
      s.exp.mode = 0;
      s.exp.signY = 0;
      s.exp.signP = 0;
      s.exp.prevDy = 0;
      s.exp.prevDp = 0;
      s.exp.startT = 0;
      s.exp.samples = 0;
      s.exp.total = 0;
      s.exp.ratiosY.length = 0;
      s.exp.ratiosP.length = 0;
      s.exp.flagged = false;
      s.exp.last = null;
    }

    function analyzeCurveSmooth(rec, prev, sample, delta) {
      const dt = sample.t - prev.t;
      if (dt <= 0) return;

      const c = rec.yokaiSmooth;
      const reset = () => {
        c.curveHist.length = 0;
        c.curveSign = 0;
        c.curveRun = 0;
        c.curveStartT = 0;
      };

      if (dt > 250 || Math.abs(delta) > 60) {
        reset();
        return;
      }

      const sign = Math.sign(delta);
      if (c.curveSign && sign !== c.curveSign) reset();
      c.curveSign = sign;
      c.curveHist.push({ t: sample.t, d: delta });
      if (c.curveHist.length === 1) c.curveStartT = prev.t;

      const window = 12;
      while (c.curveHist.length > window + 4) c.curveHist.shift();
      if (c.curveHist.length < window) return;

      const win = c.curveHist.slice(-window);
      let sgn = 0;
      let sum = 0;
      let minAbs = Infinity;
      let minD = Infinity;
      let maxD = -Infinity;
      for (const it of win) {
        const s = Math.sign(it.d);
        if (s === 0 || (sgn !== 0 && s !== sgn)) { reset(); return; }
        sgn = s;
        sum += Math.abs(it.d);
        minAbs = Math.min(minAbs, Math.abs(it.d));
        minD = Math.min(minD, it.d);
        maxD = Math.max(maxD, it.d);
      }

      const mean = sum / win.length;
      if (mean < 1.8 || minAbs < 0.2) {
        reset();
        return;
      }

      let variance = 0;
      for (const it of win) {
        const v = Math.abs(it.d) - mean;
        variance += v * v;
      }
      const cv = Math.sqrt(variance / win.length) / mean;
      const rangeRatio = (maxD - minD) / mean;
      if (cv < 0.08 || rangeRatio < 0.45) {
        reset();
        return;
      }

      const acc = [];
      for (let i = 1; i < win.length; i++) acc.push(win[i].d - win[i - 1].d);
      let accSum = 0;
      for (const a of acc) accSum += Math.abs(a);
      const meanAcc = accSum / acc.length;
      const accRatio = meanAcc / mean;
      if (accRatio < 0.015 || accRatio > 0.6) {
        reset();
        return;
      }

      const jerk = [];
      for (let i = 1; i < acc.length; i++) jerk.push(acc[i] - acc[i - 1]);
      let jerkSum = 0;
      for (const j of jerk) jerkSum += Math.abs(j);
      const meanJerk = jerkSum / jerk.length;
      const jerkRatio = meanJerk / Math.max(meanAcc, 1e-9);
      if (jerkRatio > 0.35) {
        reset();
        return;
      }

      const accChanges = signChanges(acc);
      const jerkChanges = signChanges(jerk);
      if (accChanges > 1 || jerkChanges > 1) {
        reset();
        return;
      }

      c.curveRun++;
      c.lastCurve = {
        endT: sample.t,
        samples: c.curveRun,
        duration: sample.t - c.curveStartT
      };
    }

    function analyzeExpSmooth(rec, prev, sample, dyaw, dpitch) {
      const e = rec.yokaiSmooth.exp;
      const reset = () => {
        e.mode = 0;
        e.signY = 0;
        e.signP = 0;
        e.prevDy = 0;
        e.prevDp = 0;
        e.startT = 0;
        e.samples = 0;
        e.total = 0;
        e.ratiosY.length = 0;
        e.ratiosP.length = 0;
        e.flagged = false;
      };
      const begin = (mode, sy, sp, ay, ap) => {
        e.mode = mode;
        e.signY = sy;
        e.signP = sp;
        e.prevDy = ay;
        e.prevDp = ap;
        e.startT = prev.t;
        e.samples = 1;
        e.total = mode === 2 ? ay + ap : (mode === 1 ? ay : ap);
        e.ratiosY.length = 0;
        e.ratiosP.length = 0;
        e.flagged = false;
      };

      const dt = sample.t - prev.t;
      if (dt <= 0 || dt > 250) {
        reset();
        return;
      }

      const ay = Math.abs(dyaw);
      const ap = Math.abs(dpitch);
      const actY = ay >= 0.2;
      const actP = ap >= 0.2;
      if (!actY && !actP) { reset(); return; }
      if (actY && !actP && ap > 0.6) { reset(); return; }
      if (!actY && actP && ay > 0.6) { reset(); return; }

      const sy = actY ? Math.sign(dyaw) : 0;
      const sp = actP ? Math.sign(dpitch) : 0;
      if ((actY && !sy) || (actP && !sp)) { reset(); return; }
      const mode = actY && actP ? 2 : (actY ? 1 : 3);

      if (!e.mode) {
        begin(mode, sy, sp, ay, ap);
        return;
      }
      if (e.mode === 2 && (actY || actP)) {
        if ((actY && e.signY && sy !== e.signY) || (actP && e.signP && sp !== e.signP)) {
          begin(2, sy, sp, ay, ap);
          return;
        }
      } else if (e.mode !== mode ||
        (actY && e.signY && sy !== e.signY) ||
        (actP && e.signP && sp !== e.signP)) {
        begin(mode, sy, sp, ay, ap);
        return;
      }

      const ry = actY ? ay / e.prevDy : 1;
      const rp = actP ? ap / e.prevDp : 1;
      if ((actY && (ry < 0.30 || ry > 0.98)) ||
          (actP && (rp < 0.30 || rp > 0.98)) ||
          (mode === 2 && actY && actP && Math.abs(ry - rp) > 0.06)) {
        begin(mode, sy, sp, ay, ap);
        return;
      }

      if (actY) e.ratiosY.push(ry);
      if (actP) e.ratiosP.push(rp);
      while (e.ratiosY.length > 24) e.ratiosY.shift();
      while (e.ratiosP.length > 24) e.ratiosP.shift();
      e.prevDy = ay;
      e.prevDp = ap;
      e.samples++;
      e.total += (actY ? ay : 0) + (actP ? ap : 0);

      const duration = sample.t - e.startT;
      const all = e.ratiosY.concat(e.ratiosP);
      const n = all.length;
      if (!n) {
        begin(mode, sy, sp, ay, ap);
        return;
      }
      const meanY = e.ratiosY.length ? e.ratiosY.reduce((a, b) => a + b, 0) / e.ratiosY.length : 0;
      const meanP = e.ratiosP.length ? e.ratiosP.reduce((a, b) => a + b, 0) / e.ratiosP.length : 0;
      const mean = all.reduce((a, b) => a + b, 0) / n;
      let variance = 0;
      for (const r of all) variance += (r - mean) ** 2;
      const std = Math.sqrt(variance / n);
      const axisDiff = mode === 2 ? Math.abs(meanY - meanP) : 0;

      if (!e.flagged &&
          e.samples >= 5 &&
          duration >= 130 &&
          e.total >= 6 &&
          std <= 0.06 &&
          axisDiff <= 0.06) {
        e.flagged = true;
        e.last = {
          endT: sample.t,
          samples: e.samples,
          duration,
          total: e.total
        };
        addVl(rec, 'smoothAimVl', 3.6, 6.0, 'SmoothAim', sample.t);
      }

      if (e.flagged && e.last) {
        e.last.endT = sample.t;
        e.last.samples = e.samples;
        e.last.duration = duration;
        e.last.total = e.total;
      }
    }

    function checkSmoothAim(rec, p, now) {
      if (!config.smoothAim) {
        return;
      }

      const sample = {
        t: now,
        yaw: Number(p.yaw),
        pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Number(p.pitch)))
      };

      const prev = rec.samples.length ? rec.samples[rec.samples.length - 1] : null;
      if (prev) {
        const dt = sample.t - prev.t;
        if (dt > 0) {
          const dyaw = wrapDeg((sample.yaw - prev.yaw) * RAD2DEG);
          const dpitch = (sample.pitch - prev.pitch) * RAD2DEG;
          const delta = Math.abs(dyaw) >= Math.abs(dpitch) ? dyaw : dpitch;

          analyzeExpSmooth(rec, prev, sample, dyaw, dpitch);
          analyzeCurveSmooth(rec, prev, sample, delta);

          const hist = rec.yokaiSmooth.hist;
          const resetRun = () => {
            hist.length = 0;
            rec.yokaiSmooth.run = 0;
            rec.yokaiSmooth.runStartT = 0;
          };

          if (dt > 250 || Math.abs(delta) > 45) {
            resetRun();
          } else {
            hist.push({ t: sample.t, d: delta });
            if (hist.length === 1) rec.yokaiSmooth.runStartT = prev.t;
            while (hist.length > 16) hist.shift();

            if (hist.length >= 8) {
              const win = hist.slice(-8);
              let sign = 0;
              let sum = 0;
              let minAbs = Infinity;
              let valid = true;
              for (const it of win) {
                const s = Math.sign(it.d);
                if (s === 0 || (sign !== 0 && s !== sign)) { valid = false; break; }
                sign = s;
                sum += Math.abs(it.d);
                minAbs = Math.min(minAbs, Math.abs(it.d));
              }

              if (!valid || minAbs < 0.25) {
                resetRun();
              } else {
                const mean = sum / win.length;
                if (mean < 3.0) {
                  resetRun();
                } else {
                  let variance = 0;
                  for (const it of win) {
                    const v = Math.abs(it.d) - mean;
                    variance += v * v;
                  }
                  const cv = Math.sqrt(variance / win.length) / mean;
                  let jerk = 0;
                  for (let i = 1; i < win.length; i++) jerk += Math.abs(win[i].d - win[i - 1].d);
                  const jerkRatio = jerk / ((win.length - 1) * mean);

                  if (cv > 0.10 || jerkRatio > 0.12) {
                    resetRun();
                  } else {
                    rec.yokaiSmooth.run++;
                    rec.yokaiSmooth.lastRun = {
                      endT: sample.t,
                      samples: rec.yokaiSmooth.run,
                      duration: sample.t - rec.yokaiSmooth.runStartT,
                      mean,
                      cv
                    };
                  }
                }
              }
            }
          }
        }
      }

      rec.prevYaw = p.yaw;
      rec.prevPitch = p.pitch;
      rec.prevAt = now;
    }

    function resolveFlickShots(rec, sample, now) {
      const pending = rec.pendingFlickShots;
      if (!pending.length) return;

      for (const item of pending) {
        const preAge = item.shotT - item.pre.t;
        const postAge = now - item.shotT;
        if (preAge < 0 || preAge > 120) continue;
        if (postAge < 0 || postAge > 150) continue;

        const gap = angleDeg(item.pre.yaw, item.pre.pitch, sample.yaw, sample.pitch);
        const shotDelta = angleDeg(item.pre.yaw, item.pre.pitch, item.shotYaw, item.shotPitch);
        if (gap > 35 || shotDelta < 25 || shotDelta <= gap + 10) continue;

        rec.flickAttempts++;
        if (item.hit) rec.flickHits++;
        else rec.flickMisses++;
        if (rec.flickAttempts >= 10 && rec.flickHits > rec.flickMisses) {
          addVl(rec, 'snapVl', 2.2, 6.0, 'RotationSnap', now);
        }
      }

      pending.length = 0;
    }

    function checkBhopSpeed(rec, p, hSpeed, now) {
      if (!config.bhopSpeed) {
        return;
      }

      if (hSpeed > 11.5) {
        rec.highSpeedStreak++;

        if (rec.highSpeedStreak >= 2) {
          addVl(rec, 'speedVl', 2.6, 6.0, 'Speed', now);
        }
      } else {
        rec.highSpeedStreak = 0;
      }

      // Only sample non-sliding ground movement so legit slides (up to 11 m/s)
      // and jumping/sliding off high ledges (mid-air falls) never false-positive.
      if (p.ground && !p.sliding) {
        rec.speedSamples.push({ t: now, s: hSpeed });

        while (rec.speedSamples.length > 0 && now - rec.speedSamples[0].t > 2500) {
          rec.speedSamples.shift();
        }

        if (rec.speedSamples.length >= 45) {
          let sum = 0;

          for (const sample of rec.speedSamples) {
            sum += sample.s;
          }

          if (sum / rec.speedSamples.length > 8.25) {
            addVl(rec, 'speedVl', 1.8, 6.0, 'Speed', now);
          }
        }
      } else if (rec.speedSamples.length > 0 && now - rec.speedSamples[rec.speedSamples.length - 1].t > 2500) {
        rec.speedSamples.length = 0;
      }

      if (rec.wasGround === false && p.ground && !p.sliding && hSpeed > 8.35) {
        rec.fastLandings.push(now);

        while (rec.fastLandings.length > 0 && now - rec.fastLandings[0] > 4000) {
          rec.fastLandings.shift();
        }

        if (rec.fastLandings.length >= 3) {
          addVl(rec, 'speedVl', 2.1, 6.0, 'Speed', now);
        }
      }
    }

    function checkNoJumpDelay(rec, p, hSpeed, now) {
      if (!config.noJumpDelay) {
        return;
      }

      if (rec.wasGround !== null) {
        if (!rec.wasGround && p.ground) {
          rec.landedAt = now;
          rec.landedFromFall = rec.prevVy < -2.0;
        } else if (rec.wasGround && !p.ground && p.vy > 5.0) {
          if (rec.landedAt > 0 && rec.landedFromFall && now - rec.landedAt <= 75 && hSpeed >= 4.5) {
            rec.instantHops++;
            rec.lastHopAt = now;
          } else if (now - rec.landedAt > 120) {
            rec.instantHops = 0;
          }
          rec.landedFromFall = false;
        } else if (!rec.wasGround && !p.ground && rec.prevVy < -2.5 && p.vy > 5.5 && hSpeed >= 4.5) {
          rec.instantHops++;
          rec.lastHopAt = now;
        }

        if (p.ground && rec.landedAt > 0 && now - rec.landedAt > 120) {
          rec.instantHops = 0;
        }

        if (rec.instantHops > 0 && now - rec.lastHopAt > 3500) {
          rec.instantHops = 0;
        }

        if (rec.instantHops >= 3) {
          addVl(rec, 'jumpVl', 1.6, 5.5, 'NoJumpDelay', now);
        }
      }

      rec.wasGround = Boolean(p.ground);
      rec.prevVy = Number(p.vy) || 0;
    }

    function pushSnapHistory(p, now) {
      const key = String(p.id);
      let list = snapHistoryById.get(key);

      if (!list) {
        list = [];
        snapHistoryById.set(key, list);
      }

      const h = p.sliding ? 0.95 : p.crouch ? 1.2 : 1.8;
      list.push({
        t: now,
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        z: Number(p.z) || 0,
        yaw: Number(p.yaw) || 0,
        pitch: Number(p.pitch) || 0,
        h,
        alive: Boolean(p.alive)
      });

      while (list.length > 0 && now - list[0].t > 1200) {
        list.shift();
      }
    }

    function checkPerfectShoot(attackerId, victimId, isHead, now) {
      if (!config.perfectShoot || typeof bridge.worldLineClear !== 'function') {
        return null;
      }

      const aHist = snapHistoryById.get(String(attackerId));
      const vHist = snapHistoryById.get(String(victimId));

      if (!aHist || !vHist || aHist.length < 3 || vHist.length < 3) {
        return null;
      }

      const latestV = vHist[vHist.length - 1];
      const latestA = aHist[aHist.length - 1];

      if (!latestA.alive || !latestV.alive) {
        return null;
      }

      let firstVisibleAt = null;
      let hadBlockedBefore = false;

      for (let i = vHist.length - 1; i >= 0; i--) {
        const vs = vHist[i];
        if (!vs.alive) {
          break;
        }

        // Find closest attacker sample around vs.t
        let as = latestA;
        let bestDt = Infinity;

        for (let j = aHist.length - 1; j >= 0; j--) {
          const dt = Math.abs(aHist[j].t - vs.t);
          if (dt < bestDt) {
            bestDt = dt;
            as = aHist[j];
          }
        }

        const eye = { x: as.x, y: as.y + Math.max(0.6, as.h - 0.16), z: as.z };
        const vHead = { x: vs.x, y: vs.y + Math.max(0.6, vs.h - 0.17), z: vs.z };
        const vChest = { x: vs.x, y: vs.y + vs.h * 0.58, z: vs.z };
        const visible = bridge.worldLineClear(eye, vHead) || bridge.worldLineClear(eye, vChest);

        if (visible) {
          firstVisibleAt = vs.t;
        } else {
          if (firstVisibleAt !== null) {
            hadBlockedBefore = true;
          }
          break;
        }
      }

      if (hadBlockedBefore && firstVisibleAt !== null) {
        const exposedMs = now - firstVisibleAt;

        if (exposedMs >= 0 && exposedMs <= 165) {
          // If the attacker was already pre-aiming near the victim before exposure (no large flick), do not add VL
          const preSample = aHist.find((s) => s.t >= firstVisibleAt - 220 && s.t <= firstVisibleAt) || aHist[0];
          const vPreSample = vHist.find((s) => s.t >= preSample.t) || latestV;
          if (preSample && vPreSample) {
            const dx = vPreSample.x - preSample.x;
            const dz = vPreSample.z - preSample.z;
            const hLen = Math.hypot(dx, dz);
            if (hLen > 0.5) {
              const fx = -Math.sin(preSample.yaw);
              const fz = -Math.cos(preSample.yaw);
              const preAimDot = (dx * fx + dz * fz) / hLen;
              if (preAimDot > 0.95) {
                return null;
              }
            }
          }

          return isHead ? 2.8 : 2.1;
        }
      }

      return null;
    }

    function processSnapshot() {
      if (!config.enabled) {
        return;
      }

      const snap = bridge.getRawSnapshot?.();

      if (!snap || !Array.isArray(snap.players) || snap.tick === lastSnapTick) {
        return;
      }

      lastSnapTick = snap.tick;
      const now = performance.now();
      const myId = bridge.getEngineState?.()?.engine?.net?.id;

      for (const p of snap.players) {
        if (!p || p.id == null) {
          continue;
        }

        latestSnapById.set(String(p.id), p);
        pushSnapHistory(p, now);

        if (p.bot) {
          continue;
        }

        if (config.ignoreSelf && myId != null && Number(p.id) === Number(myId)) {
          continue;
        }

        if (isIrcIgnored(p.id)) {
          continue;
        }

        const rec = getRecord(p.id, resolveActorName(p.id));
        decayAllVl(rec, now);

        if (!p.alive) {
          rec.prevYaw = null;
          rec.prevPitch = null;
          rec.prevAt = 0;
          rec.accumYaw = 0;
          rec.yawDir = 0;
          rec.spinTime = 0;
          rec.highSpeedStreak = 0;
          rec.speedSamples.length = 0;
          rec.wasGround = null;
          rec.instantHops = 0;
          rec.angSamples.length = 0;
          rec.samples.length = 0;
          rec.pendingFlickShots.length = 0;
          resetYokaiSmooth(rec);
          continue;
        }

        const hSpeed = Math.hypot(Number(p.vx) || 0, Number(p.vz) || 0);
        const sample = {
          t: now,
          yaw: Number(p.yaw),
          pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Number(p.pitch)))
        };

        if (config.rotationSnap && Number.isFinite(sample.yaw) && Number.isFinite(sample.pitch)) {
          resolveFlickShots(rec, sample, now);
          const prevSample = rec.samples.length ? rec.samples[rec.samples.length - 1] : null;
          if (prevSample) {
            const stepDeg = angleDeg(prevSample.yaw, prevSample.pitch, sample.yaw, sample.pitch);
            if (stepDeg >= 100) {
              rec.lastBigTurnAt = now;
              rec.lastBigTurnDeg = stepDeg;
            }
          }
        }

        checkSpinDerp(rec, p, now);
        checkSmoothAim(rec, p, now);
        checkBhopSpeed(rec, p, hSpeed, now);
        checkNoJumpDelay(rec, p, hSpeed, now);

        if (Number.isFinite(sample.yaw) && Number.isFinite(sample.pitch)) {
          rec.samples.push(sample);
          while (rec.samples.length > 64) {
            rec.samples.shift();
          }
        }
      }
    }

    function handleEvent(engine, event) {
      if (!config.enabled || !event) {
        return;
      }

      const myId = engine?.net?.id;

      if (event.type === 'damage' && event.weapon !== 'melee') {
        if (event.attacker == null || (config.ignoreSelf && myId != null && Number(event.attacker) === Number(myId)) || isIrcIgnored(event.attacker)) {
          return;
        }

        const snapP = latestSnapById.get(String(event.attacker));

        if (snapP?.bot) {
          return;
        }

        const rec = getRecord(event.attacker, resolveActorName(event.attacker));
        const now = performance.now();
        decayAllVl(rec, now);

        if (config.rotationSnap && rec.pendingFlickShots.length) {
          const latestPending = rec.pendingFlickShots[rec.pendingFlickShots.length - 1];
          if (now - latestPending.shotT <= 100) {
            latestPending.hit = true;
          }
        }

        if (config.smoothAim) {
          const ys = rec.yokaiSmooth;
          if (ys.lastCurve && now - ys.lastCurve.endT <= 160 && ys.lastCurve.duration >= 300 && ys.lastCurve.samples >= 2) {
            addVl(rec, 'smoothAimVl', 2.4 + (event.head ? 0.7 : 0), 6.0, 'SmoothAim', now);
            ys.lastCurve = null;
          } else if (ys.lastRun && now - ys.lastRun.endT <= 200 && ys.lastRun.duration >= 90 && ys.lastRun.samples >= 5) {
            addVl(rec, 'smoothAimVl', 1.8 + (event.head ? 0.8 : 0), 6.0, 'SmoothAim', now);
            ys.lastRun = null;
          }
          if (ys.exp.last && now - ys.exp.last.endT <= 200) {
            addVl(rec, 'smoothAimVl', 1.4 + (event.head ? 0.4 : 0), 6.0, 'SmoothAim', now);
            ys.exp.last = null;
          }
        }

        if (event.weapon !== 'shotgun' && event.id != null && snapP?.pos) {
          const victimSnap = latestSnapById.get(String(event.id));
          if (victimSnap?.pos) {
            const dx = victimSnap.pos.x - snapP.pos.x;
            const dy = victimSnap.pos.y - snapP.pos.y;
            const dz = victimSnap.pos.z - snapP.pos.z;
            const dist = Math.hypot(dx, dy, dz);
            const targetSpeed = Math.hypot(Number(victimSnap.vx) || 0, Number(victimSnap.vz) || 0);

            if (config.rotationSnap && event.head && dist >= 20 && rec.lastBigTurnAt && now - rec.lastBigTurnAt <= 70 && rec.lastBigTurnDeg >= 30) {
              addVl(rec, 'snapVl', 0.8, 6.0, 'RotationSnap', now);
              rec.lastBigTurnAt = 0;
            }

            if (config.aimPrecision && rec.lastShotEvent && now - rec.lastShotEvent.t <= 100 && dist >= 18 && targetSpeed >= 0.6) {
              const eyeY = Number(snapP.pos.y) + (Number(snapP.h) > 0.5 ? Number(snapP.h) - 0.16 : 1.62);
              const vEyeY = Number(victimSnap.pos.y) + (Number(victimSnap.h) > 0.5 ? Number(victimSnap.h) - 0.16 : 1.62);
              const precDeg = shotPrecisionDeg(
                { x: Number(snapP.pos.x), y: eyeY, z: Number(snapP.pos.z) },
                rec.lastShotEvent.dir,
                { x: Number(victimSnap.pos.x), y: vEyeY, z: Number(victimSnap.pos.z) }
              );

              if (precDeg !== null) {
                if (event.head && precDeg <= 0.18) {
                  addVl(rec, 'aimPrecisionVl', (dist >= 30 ? 1.0 : 0.6) + (targetSpeed >= 2 ? 0.3 : 0), 6.0, 'AimPrecision', now);
                }

                rec.precSamples.push(precDeg);
                while (rec.precSamples.length > 8) rec.precSamples.shift();
                rec.precEvalCount++;
                if (rec.precSamples.length >= 8 && rec.precEvalCount % 4 === 0) {
                  const n = rec.precSamples.length;
                  const mean = rec.precSamples.reduce((a, b) => a + b, 0) / n;
                  const variance = rec.precSamples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
                  const std = Math.sqrt(variance);
                  if (mean <= 0.30 && std <= 0.06) {
                    addVl(rec, 'aimPrecisionVl', 1.6, 6.0, 'AimPrecision', now);
                  }
                }
              }
            }
          }
        }

        if (!config.highHeadshot) {
          return;
        }

        if (event.weapon === 'shotgun') {
          if (now - rec.lastShotgunBurstAt < 80) {
            return;
          }
          rec.lastShotgunBurstAt = now;
        }

        if (event.head) {
          const dt = rec.lastHeadAt > 0 ? (now - rec.lastHeadAt) : 9999;

          if (dt <= 450) {
            rec.headStreak++;
          } else if (dt <= 1400) {
            rec.headStreak = Math.max(1, rec.headStreak);
          } else {
            rec.headStreak = 1;
          }

          let gain = 0.2;
          if (dt <= 350) {
            gain = 0.85 + Math.min(1.0, rec.headStreak * 0.2);
          } else if (dt <= 900) {
            gain = 0.55 + Math.min(0.6, rec.headStreak * 0.12);
          }

          rec.lastHeadAt = now;
          const hsThreshold = Math.max(11.0, (config.flagVl || 6.0) * 1.6);
          if (rec.headStreak >= 4) {
            addVl(rec, 'hsVl', gain, hsThreshold, 'HighHS', now);
          } else {
            decayAllVl(rec, now);
            rec.hsVl = Math.max(0, rec.hsVl + gain);
          }
        } else {
          rec.headStreak = 0;
          rec.hsVl = Math.max(0, rec.hsVl - 0.85);
        }

        return;
      }

      if (event.type === 'kill' && event.weapon !== 'melee') {
        if (event.killer == null || (config.ignoreSelf && myId != null && Number(event.killer) === Number(myId)) || isIrcIgnored(event.killer)) {
          return;
        }

        const snapP = latestSnapById.get(String(event.killer));

        if (snapP?.bot) {
          return;
        }

        const rec = getRecord(event.killer, resolveActorName(event.killer));
        const now = performance.now();
        decayAllVl(rec, now);

        if (config.highHeadshot) {
          if (event.head) {
            const killDt = rec.lastHeadKillAt > 0 ? (now - rec.lastHeadKillAt) : 9999;
            rec.lastHeadKillAt = now;
            const hsThreshold = Math.max(11.0, (config.flagVl || 6.0) * 1.6);
            if (rec.headStreak >= 4) {
              addVl(rec, 'hsVl', killDt <= 2500 ? 1.0 : 0.25, hsThreshold, 'HighHS', now);
            } else {
              rec.hsVl = Math.max(0, rec.hsVl + (killDt <= 2500 ? 0.6 : 0.2));
            }
          } else {
            rec.headStreak = 0;
            rec.hsVl = Math.max(0, rec.hsVl - 1.0);
          }
        }

        if (config.smoothAim) {
          const ys = rec.yokaiSmooth;
          if (ys.lastCurve && now - ys.lastCurve.endT <= 160 && ys.lastCurve.duration >= 300 && ys.lastCurve.samples >= 2) {
            addVl(rec, 'smoothAimVl', 2.4 + (event.head ? 0.7 : 0), 6.0, 'SmoothAim', now);
            ys.lastCurve = null;
          } else if (ys.lastRun && now - ys.lastRun.endT <= 200 && ys.lastRun.duration >= 90 && ys.lastRun.samples >= 5) {
            addVl(rec, 'smoothAimVl', 1.8 + (event.head ? 0.8 : 0), 6.0, 'SmoothAim', now);
            ys.lastRun = null;
          }
          if (ys.exp.last && now - ys.exp.last.endT <= 200) {
            addVl(rec, 'smoothAimVl', 1.4 + (event.head ? 0.4 : 0), 6.0, 'SmoothAim', now);
            ys.exp.last = null;
          }
        }

        if (config.perfectShoot && event.victim != null) {
          const psGain = checkPerfectShoot(event.killer, event.victim, Boolean(event.head), now);
          if (psGain) {
            addVl(rec, 'perfectShootVl', psGain, 6.0, 'PerfectShoot', now);
          }
        }

        return;
      }

      if (event.type === 'shot' && event.weapon !== 'melee') {
        if (event.id == null || (config.ignoreSelf && myId != null && Number(event.id) === Number(myId)) || isIrcIgnored(event.id)) {
          return;
        }

        const snapP = latestSnapById.get(String(event.id));

        if (!snapP || snapP.bot || !snapP.alive) {
          return;
        }

        const now = performance.now();
        const rec = getRecord(event.id, resolveActorName(event.id));
        const dx = Number(event.dx) || 0;
        const dy = Number(event.dy) || 0;
        const dz = Number(event.dz) || 0;
        const xzLen = Math.hypot(dx, dz);
        const dirLen = Math.hypot(dx, dy, dz);

        if (dirLen > 1e-4) {
          const shotYaw = Math.atan2(-dx, -dz);
          const shotPitch = Math.atan2(dy, Math.max(1e-6, xzLen));
          rec.lastShotEvent = {
            t: now,
            dir: { x: dx / dirLen, y: dy / dirLen, z: dz / dirLen },
            yaw: shotYaw,
            pitch: shotPitch
          };

          if (config.rotationSnap && rec.samples.length) {
            const pre = rec.samples[rec.samples.length - 1];
            const preAge = now - pre.t;
            if (preAge >= 0 && preAge <= 120) {
              rec.pendingFlickShots.push({
                pre,
                shotT: now,
                shotYaw,
                shotPitch,
                hit: false
              });
              while (rec.pendingFlickShots.length > 8) {
                rec.pendingFlickShots.shift();
              }
            }
          }

          if (config.silentAim && rec.samples.length) {
            let bestExcess = Infinity;
            const weapon = typeof event.weapon === 'string' ? event.weapon : '';
            const extra = WEAPON_EXTRA_TOLERANCE_DEG[weapon] || 0;

            for (let i = rec.samples.length - 1; i >= 0; i--) {
              const s = rec.samples[i];
              const ageMs = now - s.t;
              if (ageMs > 70) break;
              if (ageMs < -30) continue;
              const gap = angleDeg(s.yaw, s.pitch, shotYaw, shotPitch);
              const prevS = i > 0 ? rec.samples[i - 1] : null;
              let speed = 0;
              if (prevS && s.t > prevS.t) {
                speed = (angleDeg(prevS.yaw, prevS.pitch, s.yaw, s.pitch) * 1000) / (s.t - prevS.t);
              }
              const ageSec = Math.abs(ageMs) / 1000;
              const allowed = Math.min(60, 3.5 + extra + speed * (ageSec + 0.02));
              if (gap - allowed < bestExcess) {
                bestExcess = gap - allowed;
              }
            }

            if (bestExcess > 0 && bestExcess < Infinity) {
              addVl(rec, 'silentVl', Math.max(0.8, Math.min(2.4, 0.8 + bestExcess / 6)), 6.0, 'SilentAim', now);
            } else if (xzLen > 0.5) {
              const fx = -Math.sin(snapP.yaw);
              const fz = -Math.cos(snapP.yaw);
              const dot = (dx * fx + dz * fz) / xzLen;
              if (dot < 0.0) {
                addVl(rec, 'silentVl', 1.5, 6.0, 'SilentAim', now);
              }
            }
          }
        }
      }
    }

    function installEventHook() {
      const engine = bridge.getEngineState?.()?.engine || window.GH?.debug?.engine;

      if (!engine || typeof engine.applyEvent !== 'function' || engine.applyEvent.__solsticeAntiCheat) {
        return;
      }

      const originalApplyEvent = engine.applyEvent;
      const wrappedApplyEvent = function wrappedAntiCheatApplyEvent(event, ...rest) {
        const result = originalApplyEvent.call(this, event, ...rest);

        try {
          handleEvent(this, event);
        } catch {

        }

        return result;
      };

      Object.defineProperty(wrappedApplyEvent, '__solsticeAntiCheat', { value: true });
      engine.applyEvent = wrappedApplyEvent;
    }

    function resetAll() {
      records.clear();
      latestSnapById.clear();
      snapHistoryById.clear();
      lastSnapTick = -1;
    }

    if (typeof bridge.provide === 'function') {
      bridge.provide('anticheat', {
        isCheater: (actorOrId) => {
          if (!config.enabled || actorOrId == null) {
            return false;
          }

          const id = typeof actorOrId === 'object' ? actorOrId.id : actorOrId;
          const rec = id != null ? records.get(String(id)) : null;
          return Boolean(rec && rec.flags.size > 0);
        },
        getVl: (actorOrId) => {
          if (!config.enabled || actorOrId == null) {
            return 0;
          }

          const id = typeof actorOrId === 'object' ? actorOrId.id : actorOrId;
          const rec = id != null ? records.get(String(id)) : null;
          if (!rec) {
            return 0;
          }

          decayAllVl(rec, performance.now());
          return rec.spinVl + rec.speedVl + rec.jumpVl + rec.hsVl + rec.silentVl + rec.perfectShootVl + rec.smoothAimVl + rec.snapVl + rec.aimPrecisionVl;
        },
        getInfo: (actorOrId) => {
          if (!config.enabled || actorOrId == null) {
            return null;
          }

          const id = typeof actorOrId === 'object' ? actorOrId.id : actorOrId;
          const rec = id != null ? records.get(String(id)) : null;

          if (!rec || rec.flags.size === 0) {
            return null;
          }

          return {
            id: rec.id,
            name: rec.name,
            reasons: Array.from(rec.flags)
          };
        },
        clear: resetAll
      });
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }

      config = {
        enabled: Boolean(data.enabled),
        spinDerp: data.spinDerp !== false,
        bhopSpeed: data.bhopSpeed !== false,
        noJumpDelay: data.noJumpDelay !== false,
        highHeadshot: data.highHeadshot !== false,
        silentAim: data.silentAim !== false,
        perfectShoot: data.perfectShoot !== false,
        smoothAim: data.smoothAim !== false,
        rotationSnap: data.rotationSnap !== false,
        aimPrecision: data.aimPrecision !== false,
        flagVl: Math.max(3, Math.min(20, Number(data.flagVl) || 6.0)),
        notify: data.notify !== false,
        ignoreSelf: data.ignoreSelf !== false,
        ignoreIrc: data.ignoreIrc !== false
      };

      if (!config.enabled) {
        resetAll();
      }
    });

    bridge.onBeforePlayerUpdate(processSnapshot, 50);
    bridge.onReset(resetAll);
    installEventHook();
    setInterval(installEventHook, 500);
  }
})();
