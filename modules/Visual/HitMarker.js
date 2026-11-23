(() => {
  'use strict';

  const CHANNEL = 'solstice-hitmarker';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const OUTER_ORIGIN = 'https://www.bilibili.com';
  const MIN_SEND_INTERVAL_MS = 100;
  const HEARTBEAT_MS = 500;

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  let lastSentKey = '';
  let lastSentAt = 0;
  let audioCtx = null;

  let markerAlpha = 0;
  let markerSpread = 0;
  let markerHead = false;
  let markerKill = false;

  const stats = {
    kills: 0,
    deaths: 0,
    hits: 0,
    headHits: 0,
    damage: 0,
    streak: 0,
    bestStreak: 0
  };

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

  function playHitTick(head, kill) {
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
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(kill ? 1480 : head ? 1240 : 880, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {

    }
  }

  function syncConfig() {
    const module = getMod('HitMarker');

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
      enabled: Boolean(module.on)
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
    if (event.origin !== GAME_ORIGIN || event.data?.channel !== CHANNEL) {
      return;
    }

    const frame = findGameFrame();

    if (!frame || event.source !== frame.contentWindow) {
      return;
    }

    const module = getMod('HitMarker');

    if (!module?.on) {
      return;
    }

    const msg = event.data;

    if (msg.type === 'hit') {
      markerAlpha = 1;
      markerSpread = msg.kill ? 10 : msg.head ? 8 : 6;
      markerHead = Boolean(msg.head);
      markerKill = Boolean(msg.kill);

      stats.hits++;
      if (msg.head) {
        stats.headHits++;
      }
      stats.damage += Math.max(0, Number(msg.amount) || 0);

      if (setting(module, 'Hit Sound', false)) {
        playHitTick(markerHead, markerKill);
      }

      return;
    }

    if (msg.type === 'kill') {
      if (msg.isMyKill) {
        stats.kills++;
        stats.streak++;
        if (stats.streak > stats.bestStreak) {
          stats.bestStreak = stats.streak;
        }
      }

      if (msg.isMyDeath) {
        stats.deaths++;
        stats.streak = 0;
      }

      return;
    }

    if (msg.type === 'reset') {
      stats.kills = 0;
      stats.deaths = 0;
      stats.hits = 0;
      stats.headHits = 0;
      stats.damage = 0;
      stats.streak = 0;
      stats.bestStreak = 0;
    }
  });

  function drawHitMarker(dt) {
    syncConfig();

    const module = getMod('HitMarker');

    if (!module?.on) {
      return;
    }

    const now = performance.now();

    ctx.save();
    ctx.scale(K, K);
    const AW = W / K;
    const AH = H / K;

    if (setting(module, 'Crosshair Marker', true) && markerAlpha > 0.01) {
      markerAlpha = Math.max(0, markerAlpha - dt * 4.2);
      markerSpread = animate(3, markerSpread, dt * 16);

      const cx = AW * 0.5;
      const cy = AH * 0.5;
      const inner = markerSpread;
      const outer = markerSpread + (markerKill ? 9 : 7);
      const color = markerKill ? [255, 209, 102] : markerHead ? [255, 75, 92] : [255, 255, 255];

      ctx.strokeStyle = rgb(color, markerAlpha);
      ctx.lineWidth = markerHead || markerKill ? 2.4 : 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - outer, cy - outer);
      ctx.lineTo(cx - inner, cy - inner);
      ctx.moveTo(cx + inner, cy - inner);
      ctx.lineTo(cx + outer, cy - outer);
      ctx.moveTo(cx - outer, cy + outer);
      ctx.lineTo(cx - inner, cy + inner);
      ctx.moveTo(cx + inner, cy + inner);
      ctx.lineTo(cx + outer, cy + outer);
      ctx.stroke();
    }

    if (setting(module, 'Session Stats', true)) {
      const width = 205;
      const height = 74;
      const layout = hudElement('SessionStats', 20, 210, width, height);
      layout.w = width;
      layout.h = height;

      ctx.save();
      hudApplyScale(layout);
      const x = layout.x;
      const y = layout.y;
      const accent = themed(x + y);
      const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : stats.kills.toFixed(2);
      const hsRate = stats.hits > 0 ? Math.round((stats.headHits / stats.hits) * 100) : 0;

      fillRR(x, y, width, height, 8, [12, 14, 20], 0.72, CORNER_TOP | CORNER_BOTTOM);
      fillRR(x, y + 8, 3, height - 16, 2, accent, 0.95, CORNER_TOP | CORNER_BOTTOM);

      setFont(13, true);
      ctx.fillStyle = rgb(accent, 1);
      ctx.fillText('SESSION STATS', x + 12, y + 8);

      setFont(13, false);
      ctx.fillStyle = rgb([235, 240, 248], 0.95);
      ctx.fillText(`K/D: ${stats.kills}/${stats.deaths} (${kd})`, x + 12, y + 29);
      ctx.fillText(`HS: ${hsRate}%  •  DMG: ${Math.round(stats.damage)}`, x + 12, y + 48);
      ctx.restore();
    }

    ctx.restore();
  }

  register({
    name: 'HitMarker',
    desc: 'Crosshair hit marker and session K/D & damage stats.',
    cat: 'Visual',
    nm: { l: 'hitmarker', ls: 'hit marker', n: 'HitMarker', ns: 'Hit Marker' },
    disp: '',
    settings: [
      { t: 'b', n: 'Crosshair Marker', d: 'Show animated X marker on hit.', v: 1 },
      { t: 'b', n: 'Hit Sound', d: 'Play a crisp tick sound on hit.', v: 0 },
      { t: 'b', n: 'Session Stats', d: 'Show K/D, headshot %, and damage card.', v: 1 }
    ],
    renderOrder: 7,
    onRender: drawHitMarker,
    onEnable() {
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
    let enabled = false;
    const victimHpMap = new Map();
    let lastKillKey = '';
    let lastKillAt = 0;

    function postToParent(payload) {
      try {
        window.parent.postMessage({
          channel: CHANNEL,
          ...payload
        }, OUTER_ORIGIN);
      } catch {

      }
    }

    function installEventHook() {
      const engine = bridge.getEngineState?.()?.engine || window.GH?.debug?.engine;

      if (!engine || typeof engine.applyEvent !== 'function' || engine.applyEvent.__solsticeHitMarker) {
        return;
      }

      const originalApplyEvent = engine.applyEvent;
      const wrappedApplyEvent = function wrappedHitMarkerApplyEvent(event, ...rest) {
        const result = originalApplyEvent.call(this, event, ...rest);

        try {
          if (enabled && event) {
            const myId = this.net?.id;

            if (event.type === 'spawn' && event.id != null) {
              victimHpMap.set(String(event.id), 100);
            } else if (event.type === 'round-start') {
              victimHpMap.clear();
            } else if (event.type === 'damage' && event.id != null) {
              const vKey = String(event.id);
              const prevHp = victimHpMap.has(vKey) ? victimHpMap.get(vKey) : 100;
              const nextHp = Number.isFinite(Number(event.hp)) ? Math.max(0, Math.min(100, Number(event.hp))) : null;
              const rawAmount = Number.isFinite(Number(event.amount))
                ? Math.max(0, Math.min(100, Number(event.amount)))
                : null;
              let realDamage = 0;

              if (nextHp !== null && prevHp >= nextHp) {
                const hpDelta = Math.min(100, prevHp - nextHp);
                realDamage = rawAmount !== null && rawAmount > 0 ? Math.min(hpDelta, rawAmount) : hpDelta;
              } else if (rawAmount !== null) {
                realDamage = rawAmount;
              }

              if (nextHp !== null) {
                victimHpMap.set(vKey, nextHp);
              }

              if (event.attacker === myId && event.id !== myId) {
                postToParent({
                  type: 'hit',
                  head: Boolean(event.head),
                  kill: nextHp !== null ? nextHp <= 0 : false,
                  amount: realDamage
                });
              }
            } else if (event.type === 'kill') {
              const now = performance.now();
              const kKey = `${event.killer}:${event.victim}`;
              if (kKey === lastKillKey && now - lastKillAt < 250) {
                return result;
              }
              lastKillKey = kKey;
              lastKillAt = now;
              if (event.victim != null) {
                victimHpMap.set(String(event.victim), 0);
              }

              const killer = typeof this.actor === 'function' ? this.actor(event.killer) : null;
              const victim = typeof this.actor === 'function' ? this.actor(event.victim) : null;
              postToParent({
                type: 'kill',
                killer: killer?.name || `P${event.killer ?? '?'}`,
                victim: victim?.name || `P${event.victim ?? '?'}`,
                weapon: event.weapon || '',
                head: Boolean(event.head),
                isMyKill: event.killer === myId,
                isMyDeath: event.victim === myId
              });
            }
          }
        } catch {

        }

        return result;
      };

      Object.defineProperty(wrappedApplyEvent, '__solsticeHitMarker', { value: true });
      engine.applyEvent = wrappedApplyEvent;
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config') {
        return;
      }

      enabled = Boolean(data.enabled);
    });

    if (typeof bridge.onTick === 'function') {
      bridge.onTick((snap) => {
        if (!enabled || !snap || !Array.isArray(snap.players)) {
          return;
        }

        for (let i = 0; i < snap.players.length; i++) {
          const p = snap.players[i];
          if (!p || p.id == null) {
            continue;
          }

          const hp = Number(p.hp);
          if (p.alive && Number.isFinite(hp)) {
            victimHpMap.set(String(p.id), Math.max(0, Math.min(100, hp)));
          } else if (!p.alive) {
            victimHpMap.set(String(p.id), 0);
          }
        }
      });
    }

    bridge.onReset(() => {
      postToParent({ type: 'reset' });
    });

    installEventHook();
    setInterval(installEventHook, 500);
  }
})();
