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
      { t: 'b', n: 'High Headshot', d: 'Flag rapid consecutive headshot chains (VL decay).', v: 1 },
      { t: 'b', n: 'Silent Aim', d: 'Flag shots fired far outside the player view angle.', v: 1 },
      { t: 'b', n: 'Perfect Shoot', d: 'Flag instant kills the moment an enemy exposes from cover.', v: 1 },
      { t: 'b', n: 'Smooth Aim', d: 'Flag robotic constant-velocity smooth aiming across kills.', v: 1 },
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
      perfectShoot: true,
      smoothAim: true,
      notify: true,
      ignoreSelf: true
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
          lastHeadAt: 0,
          lastHeadKillAt: 0,
          headStreak: 0,
          lastShotgunBurstAt: 0,
          angSamples: [],
          smoothTrackAt: 0
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

    const VL_DECAY_RATES = {
      spinVl: 1.2,
      speedVl: 0.8,
      jumpVl: 0.7,
      hsVl: 0.65,
      silentVl: 0.5,
      perfectShootVl: 0.35,
      smoothAimVl: 0.35
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

      if (rec[field] >= threshold) {
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

    function checkSmoothAim(rec, p, now) {
      if (!config.smoothAim) {
        return;
      }

      if (rec.prevYaw !== null && rec.prevAt > 0) {
        const dt = (now - rec.prevAt) / 1000;

        if (dt >= 0.015 && dt <= 0.12) {
          const dyaw = wrapAngle(p.yaw - rec.prevYaw);
          const dpitch = p.pitch - rec.prevPitch;
          const angDist = Math.hypot(dyaw, dpitch);
          const angSpeed = angDist / dt;

          if (angSpeed >= 0.25 && angSpeed <= 7.5) {
            rec.angSamples.push({ speed: angSpeed, dy: dyaw, dp: dpitch });

            if (rec.angSamples.length > 8) {
              rec.angSamples.shift();
            }

            if (rec.angSamples.length >= 6) {
              let sum = 0;
              let cosSum = 0;
              let cosCount = 0;

              for (let i = 0; i < rec.angSamples.length; i++) {
                sum += rec.angSamples[i].speed;

                if (i > 0) {
                  const a = rec.angSamples[i - 1];
                  const b = rec.angSamples[i];
                  const la = Math.hypot(a.dy, a.dp);
                  const lb = Math.hypot(b.dy, b.dp);

                  if (la > 1e-4 && lb > 1e-4) {
                    cosSum += (a.dy * b.dy + a.dp * b.dp) / (la * lb);
                    cosCount++;
                  }
                }
              }

              const mean = sum / rec.angSamples.length;
              let varSum = 0;

              for (const sample of rec.angSamples) {
                const d = sample.speed - mean;
                varSum += d * d;
              }

              const stdDev = Math.sqrt(varSum / rec.angSamples.length);
              const cv = mean > 0 ? stdDev / mean : 1;
              const avgCos = cosCount > 0 ? cosSum / cosCount : 0;

              if (cv < 0.08 && avgCos > 0.992) {
                rec.smoothTrackAt = now;
              }
            }
          } else {
            rec.angSamples.length = 0;
          }
        } else if (dt > 0.12) {
          rec.angSamples.length = 0;
        }
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
          continue;
        }

        const hSpeed = Math.hypot(Number(p.vx) || 0, Number(p.vz) || 0);

        checkSpinDerp(rec, p, now);
        checkSmoothAim(rec, p, now);
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
        const now = performance.now();
        decayAllVl(rec, now);

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

          let gain = 0.35;
          if (dt <= 350) {
            gain = 1.2 + Math.min(1.8, rec.headStreak * 0.35);
          } else if (dt <= 900) {
            gain = 0.85 + Math.min(1.0, rec.headStreak * 0.2);
          }

          rec.lastHeadAt = now;
          addVl(rec, 'hsVl', gain, 8.5, 'HighHS', now);
        } else {
          rec.headStreak = 0;
          rec.hsVl = Math.max(0, rec.hsVl - 0.55);
        }

        return;
      }

      if (event.type === 'kill' && event.weapon !== 'melee') {
        if (event.killer == null || (config.ignoreSelf && myId != null && Number(event.killer) === Number(myId))) {
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
            addVl(rec, 'hsVl', killDt <= 2500 ? 1.4 : 0.4, 8.5, 'HighHS', now);
          } else {
            rec.hsVl = Math.max(0, rec.hsVl - 0.8);
          }
        }

        if (config.smoothAim && rec.smoothTrackAt > 0 && now - rec.smoothTrackAt <= 1200) {
          rec.smoothTrackAt = 0;
          addVl(rec, 'smoothAimVl', 2.4, 6.0, 'SmoothAim', now);
        }

        if (config.perfectShoot && event.victim != null) {
          const psGain = checkPerfectShoot(event.killer, event.victim, Boolean(event.head), now);
          if (psGain) {
            addVl(rec, 'perfectShootVl', psGain, 6.0, 'PerfectShoot', now);
          }
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
            addVl(rec, 'silentVl', 1.5, 6.0, 'SilentAim', performance.now());
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
          return rec.spinVl + rec.speedVl + rec.jumpVl + rec.hsVl + rec.silentVl + rec.perfectShootVl + rec.smoothAimVl;
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
