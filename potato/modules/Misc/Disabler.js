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
    const mode = modeSetting?.vals?.[modeSetting.v] === 'Drop' ? 'Drop' : 'Clean Reply';
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
    desc: 'Handles ladder integrity challenges and cleans outgoing check payloads.',
    cat: 'Misc',
    nm: { l: 'disabler', ls: 'disabler', n: 'Disabler', ns: 'Disabler' },
    disp: 'Mode',
    settings: [
      { t: 'e', n: 'Mode', d: 'Clean Reply answers server challenges cleanly so ladder score is not blocked; Drop suppresses ic packets.', v: 0, vals: ['Clean Reply', 'Drop'] },
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
    let mode = 'Clean Reply';
    let cleanIntegrity = true;
    let blockFlags = true;
    let wsHooked = false;
    let fetchHooked = false;

    function updateGlobalFlag() {
      window.__solsticeDisablerActive = Boolean(enabled && mode === 'Clean Reply');
    }
    updateGlobalFlag();

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
      if (!enabled || typeof data !== 'string' || data[0] !== '{' || data.length > 131072) {
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
          if (enabled && init && typeof init.body === 'string') {
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
            if (enabled && blockFlags && msg && typeof msg === 'object' && msg.t === 'flag') {
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
      mode = data.mode === 'Drop' ? 'Drop' : 'Clean Reply';
      cleanIntegrity = data.cleanIntegrity !== false;
      blockFlags = data.blockFlags !== false;
      updateGlobalFlag();
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
