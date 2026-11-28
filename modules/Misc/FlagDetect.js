(() => {
  'use strict';

  const CHANNEL = 'solstice-flagdetect';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const OUTER_ORIGIN = 'https://www.bilibili.com';
  const HEARTBEAT_MS = 500;
  const isPotatoPath = () => location.pathname.includes('/potatoepic/') || document.documentElement?.getAttribute('data-solstice-game') === 'potatoepic';

  if (
    location.hostname === 'www.bilibilitoy.com' &&
    (location.pathname.startsWith('/toy/golden-hour/') || location.pathname.startsWith('/toy/potatoepic/'))
  ) {
    bootGame();
    return;
  }

  let lastSentKey = '';
  let lastSentAt = 0;
  let audioCtx = null;

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
    const entry = mod?.settings?.find((s) => s.n === name);
    return entry ? entry.v : fallback;
  }

  function playAlertSound(volume) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      const now = audioCtx.currentTime;
      const vol = Math.max(0.02, Math.min(1, Number(volume) || 0.45));

      const tone = (freq, startOffset, dur) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + startOffset);
        gain.gain.setValueAtTime(0.0001, now + startOffset);
        gain.gain.exponentialRampToValueAtTime(vol * 0.35, now + startOffset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + startOffset);
        osc.stop(now + startOffset + dur + 0.02);
      };

      tone(880, 0, 0.11);
      tone(660, 0.12, 0.14);
    } catch {}
  }

  function syncConfig(force = false) {
    const mod = typeof getMod === 'function' ? getMod('FlagDetect') : null;
    if (!mod) return;

    const now = performance.now();
    const payload = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(mod.on),
      minDist: Math.max(0.5, Math.min(6.0, Number(setting(mod, 'Min Distance', 1.4)) || 1.4)),
      cooldownMs: Math.max(300, Math.min(5000, Number(setting(mod, 'Cooldown', 1500)) || 1500))
    };
    const key = JSON.stringify(payload);
    if (!force && key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) return;

    const frame = findGameFrame();
    if (!frame?.contentWindow) return;

    try {
      frame.contentWindow.postMessage(payload, GAME_ORIGIN);
      lastSentKey = key;
      lastSentAt = now;
    } catch {}
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN) return;
    const d = event.data;
    if (!d || d.channel !== CHANNEL || d.type !== 'flag') return;

    const mod = typeof getMod === 'function' ? getMod('FlagDetect') : null;
    if (!mod || !mod.on) return;

    const dist = Number(d.dist) || 0;
    const msg = `[FlagDetect] 检测到拉回 (${dist.toFixed(1)}m)`;
    document.dispatchEvent(new CustomEvent('solstice:anticheat-flag', {
      detail: { message: msg }
    }));

    if (Boolean(setting(mod, 'Sound', 1))) {
      playAlertSound(Number(setting(mod, 'Volume', 0.5)));
    }
  });

  register({
    name: 'FlagDetect',
    desc: 'Detects server rubberband/setback (lagback) and alerts with notification and sound.',
    cat: 'Misc',
    nm: { l: 'flagdetect', ls: 'flag detect', n: 'FlagDetect', ns: 'Flag Detect' },
    disp: '',
    settings: [
      { t: 'n', n: 'Min Distance', d: 'Minimum sudden setback distance in blocks to trigger alert.', v: 1.4, min: 0.5, max: 6.0, step: 0.1 },
      { t: 'n', n: 'Cooldown', d: 'Minimum interval in ms between consecutive flag alerts.', v: 1500, min: 300, max: 5000, step: 100 },
      { t: 'b', n: 'Sound', d: 'Play a warning beep when a setback is detected.', v: 1 },
      { t: 'n', n: 'Volume', d: 'Alert beep volume.', v: 0.5, min: 0.1, max: 1.0, step: 0.05 }
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
    let enabled = false;
    let minDist = 1.4;
    let cooldownMs = 1500;

    let prev = null;
    let prevDir = null;
    let lastAlertAt = 0;
    let spawnGraceUntil = 0;
    const recentTrail = [];

    function resetTrack() {
      prev = null;
      prevDir = null;
      recentTrail.length = 0;
      spawnGraceUntil = performance.now() + 1200;
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') return;
      const wasEnabled = enabled;
      enabled = Boolean(data.enabled);
      minDist = Math.max(0.5, Math.min(6.0, Number(data.minDist) || 1.4));
      cooldownMs = Math.max(300, Math.min(5000, Number(data.cooldownMs) || 1500));
      if (!enabled || !wasEnabled) {
        resetTrack();
      }
    });

    if (typeof bridge.onReset === 'function') {
      bridge.onReset(resetTrack);
    }

    bridge.onBeforePlayerUpdate(() => {
      if (!enabled) return;

      const ctx = bridge.getContext();
      const player = ctx?.player;
      if (!player || player.alive === false || !player.pos) {
        resetTrack();
        return;
      }

      const now = performance.now();
      const x = Number(player.pos.x);
      const y = Number(player.pos.y);
      const z = Number(player.pos.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        resetTrack();
        return;
      }

      if (!prev) {
        prev = { x, y, z, t: now };
        recentTrail.push({ x, y, z, t: now });
        return;
      }

      const dtMs = now - prev.t;
      if (dtMs <= 0) return;

      if (dtMs > 450) {
        resetTrack();
        prev = { x, y, z, t: now };
        recentTrail.push({ x, y, z, t: now });
        return;
      }

      const dx = x - prev.x;
      const dy = y - prev.y;
      const dz = z - prev.z;
      const dist = Math.hypot(dx, dy, dz);
      const horizDist = Math.hypot(dx, dz);

      // Ignore map teleport / round spawn (> 35 blocks)
      if (dist > 35) {
        resetTrack();
        prev = { x, y, z, t: now };
        recentTrail.push({ x, y, z, t: now });
        return;
      }

      let flagged = false;
      if (now >= spawnGraceUntil && dist >= minDist) {
        // 1. Sudden reversal snapback against recent movement direction
        let reversed = false;
        if (prevDir && horizDist > 0.3) {
          const dot = (dx * prevDir.x + dz * prevDir.z) / horizDist;
          if (dot < -0.45) reversed = true;
        }

        // 2. Snapped directly back onto an older trail point from 80ms..900ms ago
        let snappedToPast = false;
        for (let i = 0; i < recentTrail.length; i++) {
          const pt = recentTrail[i];
          const age = now - pt.t;
          if (age < 80 || age > 900) continue;
          if (Math.hypot(x - pt.x, y - pt.y, z - pt.z) < 0.45) {
            snappedToPast = true;
            break;
          }
        }

        // 3. Impossible single-frame teleport jump (e.g. > max(minDist, 2.2) in < 80ms)
        const instantJump = dtMs < 80 && dist >= Math.max(minDist, 2.2);

        if (reversed || snappedToPast || instantJump) {
          flagged = true;
        }
      }

      if (flagged && now - lastAlertAt >= cooldownMs) {
        lastAlertAt = now;
        try {
          window.parent.postMessage({
            channel: CHANNEL,
            type: 'flag',
            dist
          }, OUTER_ORIGIN);
        } catch {}
      }

      if (!flagged && horizDist > 0.04) {
        prevDir = { x: dx / horizDist, z: dz / horizDist };
      }

      prev = { x, y, z, t: now };
      recentTrail.push({ x, y, z, t: now });
      while (recentTrail.length > 0 && now - recentTrail[0].t > 1000) {
        recentTrail.shift();
      }
    });
  }
})();
