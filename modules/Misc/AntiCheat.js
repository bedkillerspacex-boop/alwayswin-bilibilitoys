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
      notify: Boolean(setting(module, 'Notify', true)),
      ignoreSelf: Boolean(setting(module, 'Ignore Self', true))
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
      { t: 'b', n: 'High Headshot', d: 'Flag abnormally high headshot hit/kill rate.', v: 1 },
      { t: 'b', n: 'Silent Aim', d: 'Flag shots fired far outside the player view angle.', v: 1 },
      { t: 'b', n: 'Notify', d: 'Show a notification when a cheater is flagged.', v: 1 },
      { t: 'b', n: 'Flag Sound', d: 'Play a sound when a cheater is flagged.', v: 1 },
      { t: 'e', n: 'Sound Mode', d: 'The alert sound played when a cheater is flagged.', v: 0, vals: ['Alert', 'Chime', 'Cash', 'Windows', 'Mario', 'Fard'] },
      { t: 'n', n: 'Sound Volume', d: 'The volume of the alert sound.', v: 0.8, min: 0, max: 1, step: 0.1 },
      { t: 'b', n: 'Ignore Self', d: 'Skip anti-cheat checks on your own player.', v: 1 }
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
      notify: true,
      ignoreSelf: true
    };

    const records = new Map();
    const latestSnapById = new Map();
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
          hits: 0,
          headHits: 0,
          kills: 0,
          headKills: 0,
          silentShots: 0
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

    function checkSpinDerp(rec, p, now) {
      if (!config.spinDerp) {
        return;
      }

      if (Math.abs(p.pitch) > 1.58) {
        flagPlayer(rec, 'Derp');
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
              flagPlayer(rec, 'Spin');
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

              if (rec.pitchFlips >= 3) {
                flagPlayer(rec, 'Derp');
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

      rec.prevYaw = p.yaw;
      rec.prevPitch = p.pitch;
      rec.prevAt = now;
    }

    function checkBhopSpeed(rec, p, hSpeed, now) {
      if (!config.bhopSpeed) {
        return;
      }

      if (hSpeed > 11.5) {
        rec.highSpeedStreak++;

        if (rec.highSpeedStreak >= 3) {
          flagPlayer(rec, 'Speed');
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
            flagPlayer(rec, 'Speed');
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

        if (rec.fastLandings.length >= 4) {
          flagPlayer(rec, 'Speed');
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

        if (rec.instantHops >= 5) {
          flagPlayer(rec, 'NoJumpDelay');
        }
      }

      rec.wasGround = Boolean(p.ground);
      rec.prevVy = Number(p.vy) || 0;
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

        if (p.bot) {
          continue;
        }

        if (config.ignoreSelf && myId != null && Number(p.id) === Number(myId)) {
          continue;
        }

        const rec = getRecord(p.id, resolveActorName(p.id));

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
          continue;
        }

        const hSpeed = Math.hypot(Number(p.vx) || 0, Number(p.vz) || 0);

        checkSpinDerp(rec, p, now);
        checkBhopSpeed(rec, p, hSpeed, now);
        checkNoJumpDelay(rec, p, hSpeed, now);
      }
    }

    function handleEvent(engine, event) {
      if (!config.enabled || !event) {
        return;
      }

      const myId = engine?.net?.id;

      if (event.type === 'damage' && config.highHeadshot && event.weapon !== 'melee') {
        if (event.attacker == null || (config.ignoreSelf && myId != null && Number(event.attacker) === Number(myId))) {
          return;
        }

        const snapP = latestSnapById.get(String(event.attacker));

        if (snapP?.bot) {
          return;
        }

        const rec = getRecord(event.attacker, resolveActorName(event.attacker));
        rec.hits++;

        if (event.head) {
          rec.headHits++;
        }

        if (rec.hits >= 25 && rec.headHits / rec.hits >= 0.85) {
          flagPlayer(rec, 'HighHS');
        }

        return;
      }

      if (event.type === 'kill' && config.highHeadshot && event.weapon !== 'melee') {
        if (event.killer == null || (config.ignoreSelf && myId != null && Number(event.killer) === Number(myId))) {
          return;
        }

        const snapP = latestSnapById.get(String(event.killer));

        if (snapP?.bot) {
          return;
        }

        const rec = getRecord(event.killer, resolveActorName(event.killer));
        rec.kills++;

        if (event.head) {
          rec.headKills++;
        }

        if (rec.kills >= 10 && rec.headKills / rec.kills >= 0.90) {
          flagPlayer(rec, 'HighHS');
        }

        return;
      }

      if (event.type === 'shot' && config.silentAim && event.weapon !== 'melee') {
        if (event.id == null || (config.ignoreSelf && myId != null && Number(event.id) === Number(myId))) {
          return;
        }

        const snapP = latestSnapById.get(String(event.id));

        if (!snapP || snapP.bot || !snapP.alive) {
          return;
        }

        const xzLen = Math.hypot(Number(event.dx) || 0, Number(event.dz) || 0);

        if (xzLen > 0.5) {
          const fx = -Math.sin(snapP.yaw);
          const fz = -Math.cos(snapP.yaw);
          const dot = ((event.dx * fx) + (event.dz * fz)) / xzLen;

          if (dot < 0.0) {
            const rec = getRecord(event.id, resolveActorName(event.id));
            rec.silentShots++;

            if (rec.silentShots >= 6) {
              flagPlayer(rec, 'SilentAim');
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
        notify: data.notify !== false,
        ignoreSelf: data.ignoreSelf !== false
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
