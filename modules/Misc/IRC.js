(() => {
  'use strict';

  /* IRC 客户端模块：
     - 外层页面启动时弹出强制登录遮罩（支持记住密码、自动登录、跳转网页注册）
     - 游戏 iframe 内建立 WebSocket 连接，按 roomId / playerId 同步同房间的 IRC 用户与 Protect IRC 状态
     - 默认开启 Protect IRC（不打同开启保护的 IRC 玩家）；一旦关闭 Protect IRC，所有人都可以打你 */

  const DEFAULT_IRC_ORIGIN = 'https://cod.firebounce.today';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-irc';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;
  const STORAGE_KEYS = {
    server: 'solstice.irc.server',
    user: 'solstice.irc.user',
    pass: 'solstice.irc.pass',
    remember: 'solstice.irc.remember',
    autoLogin: 'solstice.irc.autoLogin'
  };

  let lastSentKey = '';
  let lastSentAt = 0;
  let sessionToken = '';
  let sessionIrcName = '';
  let modalOpen = false;
  let modalEl = null;
  let autoLoginAttempted = false;

  function getServerOrigin() {
    try {
      const saved = (localStorage.getItem(STORAGE_KEYS.server) || '').trim();
      return saved ? saved.replace(/\/+$/, '') : DEFAULT_IRC_ORIGIN;
    } catch {
      return DEFAULT_IRC_ORIGIN;
    }
  }

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}/toy/golden-hour/`)) {
        return frame;
      }
    }

    return null;
  }

  function boolOf(module, name, fallback) {
    const entry = module.settings.find((s) => s.n === name);
    return entry ? Boolean(entry.v) : fallback;
  }

  function syncConfig() {
    const module = getMod('IRC');

    if (!module) {
      return;
    }

    const reLoginEntry = module.settings.find((s) => s.n === 'Re-Login');

    if (reLoginEntry && reLoginEntry.v) {
      reLoginEntry.v = 0;
      openLoginModal();
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'irc',
      enabled: Boolean(module.on) && Boolean(sessionToken),
      protectIrc: boolOf(module, 'Protect IRC', true),
      token: sessionToken,
      ircName: sessionIrcName,
      serverOrigin: getServerOrigin()
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

  async function performLogin(username, password) {
    const origin = getServerOrigin();
    const res = await fetch(`${origin}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.token) {
      throw new Error(data?.error || `登录失败 (${res.status})`);
    }

    sessionToken = String(data.token);
    sessionIrcName = String(data.ircName || data.username || username);
    lastSentKey = '';
    syncConfig();
  }

  function closeLoginModal() {
    modalOpen = false;

    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  function openLoginModal() {
    if (modalOpen) {
      return;
    }

    modalOpen = true;

    const mount = () => {
      if (!document.body) {
        setTimeout(mount, 25);
        return;
      }

      if (modalEl) {
        modalEl.remove();
      }

      let savedUser = '';
      let savedPass = '';
      let savedRemember = false;
      let savedAuto = false;

      try {
        savedRemember = localStorage.getItem(STORAGE_KEYS.remember) === '1';
        savedAuto = localStorage.getItem(STORAGE_KEYS.autoLogin) === '1';
        savedUser = localStorage.getItem(STORAGE_KEYS.user) || '';
        savedPass = savedRemember ? localStorage.getItem(STORAGE_KEYS.pass) || '' : '';
      } catch {

      }

      const overlay = document.createElement('div');
      overlay.id = 'solstice-irc-login-gate';
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'background:rgba(10,12,18,0.88)',
        'backdrop-filter:blur(8px)',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
        'color:#f1f5f9'
      ].join(';');

      const origin = getServerOrigin();
      overlay.innerHTML = `
        <div style="width:360px;background:#141824;border:1px solid #2b344d;border-radius:12px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
          <div style="font-size:18px;font-weight:700;margin-bottom:6px;color:#60a5fa;">Solstice IRC 登录</div>
          <div style="font-size:12px;color:#94a3b8;margin-bottom:16px;">未登录 IRC 无法进入游戏，请在网页注册账号后登录。</div>
          <label style="display:block;font-size:12px;color:#cbd5e1;margin-bottom:4px;">用户名</label>
          <input id="s-irc-user" type="text" autocomplete="username" value="${savedUser.replace(/"/g, '&quot;')}" style="width:100%;box-sizing:border-box;padding:9px 10px;margin-bottom:12px;border-radius:8px;border:1px solid #334155;background:#0f131d;color:#fff;outline:none;" />
          <label style="display:block;font-size:12px;color:#cbd5e1;margin-bottom:4px;">密码</label>
          <input id="s-irc-pass" type="password" autocomplete="current-password" value="${savedPass.replace(/"/g, '&quot;')}" style="width:100%;box-sizing:border-box;padding:9px 10px;margin-bottom:12px;border-radius:8px;border:1px solid #334155;background:#0f131d;color:#fff;outline:none;" />
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#cbd5e1;margin-bottom:14px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input id="s-irc-rem" type="checkbox" ${savedRemember ? 'checked' : ''} /> 记住密码
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input id="s-irc-auto" type="checkbox" ${savedAuto ? 'checked' : ''} /> 自动登录
            </label>
          </div>
          <div id="s-irc-err" style="min-height:16px;font-size:12px;color:#f87171;margin-bottom:10px;"></div>
          <button id="s-irc-submit" style="width:100%;padding:10px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-weight:600;font-size:14px;cursor:pointer;">登录</button>
          <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:12px;">
            <a id="s-irc-reg" href="${origin}/register" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;text-decoration:none;">去网页注册 →</a>
            <span style="color:#64748b;">${origin}</span>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      modalEl = overlay;

      const userInput = overlay.querySelector('#s-irc-user');
      const passInput = overlay.querySelector('#s-irc-pass');
      const remCheck = overlay.querySelector('#s-irc-rem');
      const autoCheck = overlay.querySelector('#s-irc-auto');
      const errEl = overlay.querySelector('#s-irc-err');
      const btn = overlay.querySelector('#s-irc-submit');

      autoCheck.addEventListener('change', () => {
        if (autoCheck.checked) {
          remCheck.checked = true;
        }
      });

      const handleSubmit = async () => {
        const username = userInput.value.trim();
        const password = passInput.value;

        if (!username || !password) {
          errEl.textContent = '请输入用户名和密码';
          return;
        }

        btn.disabled = true;
        btn.textContent = '登录中...';
        errEl.textContent = '';

        try {
          await performLogin(username, password);
          try {
            localStorage.setItem(STORAGE_KEYS.user, username);
            localStorage.setItem(STORAGE_KEYS.remember, remCheck.checked ? '1' : '0');
            localStorage.setItem(STORAGE_KEYS.autoLogin, autoCheck.checked ? '1' : '0');
            if (remCheck.checked) {
              localStorage.setItem(STORAGE_KEYS.pass, password);
            } else {
              localStorage.removeItem(STORAGE_KEYS.pass);
            }
          } catch {

          }
          closeLoginModal();
        } catch (err) {
          errEl.textContent = err?.message || '登录失败';
        } finally {
          btn.disabled = false;
          btn.textContent = '登录';
        }
      };

      btn.addEventListener('click', handleSubmit);
      overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          handleSubmit();
        }
      });
    };

    mount();
  }

  function tryBootLogin() {
    if (autoLoginAttempted) {
      return;
    }

    autoLoginAttempted = true;

    let savedUser = '';
    let savedPass = '';
    let savedAuto = false;

    try {
      savedAuto = localStorage.getItem(STORAGE_KEYS.autoLogin) === '1' && localStorage.getItem(STORAGE_KEYS.remember) === '1';
      savedUser = localStorage.getItem(STORAGE_KEYS.user) || '';
      savedPass = localStorage.getItem(STORAGE_KEYS.pass) || '';
    } catch {

    }

    if (savedAuto && savedUser && savedPass) {
      performLogin(savedUser, savedPass).catch(() => {
        openLoginModal();
      });
    } else {
      openLoginModal();
    }
  }

  register({
    name: 'IRC',
    desc: 'Connects to Solstice IRC network; protects IRC users by default.',
    cat: 'Misc',
    nm: { l: 'irc', ls: 'irc', n: 'IRC', ns: 'IRC' },
    disp: '',
    defaultOn: true,
    settings: [
      { t: 'b', n: 'Protect IRC', d: 'Do not attack IRC users who also have Protect IRC enabled.', v: 1 },
      { t: 'b', n: 'Re-Login', d: 'Open the IRC login window.', v: 0 }
    ],
    onRender: syncConfig,
    onEnable() {}
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryBootLogin, { once: true });
  } else {
    tryBootLogin();
  }

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
    let protectIrc = true;
    let token = '';
    let serverOrigin = DEFAULT_IRC_ORIGIN;

    let ws = null;
    let wsConnected = false;
    let currentRoomId = '';
    let currentPlayerId = '';
    let enginePatched = false;
    let heartbeatTimer = 0;
    let reconnectTimer = 0;

    const peersById = new Map();

    function toWsOrigin(httpOrigin) {
      return httpOrigin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    }

    function sendState() {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const player = bridge.getGH()?.debug?.player;

      try {
        ws.send(
          JSON.stringify({
            type: 'state',
            roomId: currentRoomId,
            playerId: currentPlayerId,
            name: player?.name || '',
            protect: Boolean(enabled && protectIrc)
          })
        );
      } catch {

      }
    }

    function closeSocket() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = 0;
      }

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = 0;
      }

      wsConnected = false;
      peersById.clear();

      if (ws) {
        try {
          ws.close();
        } catch {

        }

        ws = null;
      }
    }

    function connectSocket() {
      if (!enabled || !token || !serverOrigin) {
        closeSocket();
        return;
      }

      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const wsUrl = `${toWsOrigin(serverOrigin)}/ws?token=${encodeURIComponent(token)}`;

      try {
        ws = new WebSocket(wsUrl);
      } catch {
        return;
      }

      ws.addEventListener('open', () => {
        wsConnected = true;
        sendState();
        heartbeatTimer = setInterval(sendState, 5000);
      });

      ws.addEventListener('message', (event) => {
        let msg = null;

        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg?.type === 'peers' && Array.isArray(msg.peers)) {
          peersById.clear();

          for (const peer of msg.peers) {
            if (peer && peer.playerId != null && peer.playerId !== currentPlayerId) {
              peersById.set(peer.playerId, {
                ircName: String(peer.ircName || peer.username || 'IRC'),
                protect: Boolean(peer.protect)
              });
            }
          }
        }
      });

      ws.addEventListener('close', () => {
        wsConnected = false;

        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = 0;
        }

        peersById.clear();
        ws = null;

        if (enabled && token && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = 0;
            connectSocket();
          }, 3000);
        }
      });
    }

    function installEngineTracker() {
      if (enginePatched) {
        return;
      }

      enginePatched = true;
      const engineUrl = new URL('client/engine.js', location.href).href;

      import(engineUrl)
        .then(({ Engine }) => {
          const proto = Engine?.prototype;

          if (!proto) {
            return;
          }

          if (typeof proto.setRoom === 'function' && !proto.setRoom.__solsticeIrcPatched) {
            const origSetRoom = proto.setRoom;
            const wrappedSetRoom = function wrappedIrcSetRoom(room, ...rest) {
              const nextRoomId = room?.id != null ? String(room.id) : room?.code != null ? String(room.code) : '';
              const nextPlayerId = this.net?.id != null ? String(this.net.id) : '';

              if (nextRoomId !== currentRoomId || nextPlayerId !== currentPlayerId) {
                currentRoomId = nextRoomId;
                currentPlayerId = nextPlayerId;
                sendState();
              }

              return origSetRoom.call(this, room, ...rest);
            };

            Object.defineProperty(wrappedSetRoom, '__solsticeIrcPatched', { value: true });
            proto.setRoom = wrappedSetRoom;
          }

          if (typeof proto.snapshot === 'function' && !proto.snapshot.__solsticeIrcPatched) {
            const origSnapshot = proto.snapshot;
            const wrappedSnapshot = function wrappedIrcSnapshot(s, ...rest) {
              const nextRoomId = this.room?.id != null ? String(this.room.id) : this.room?.code != null ? String(this.room.code) : currentRoomId;
              const nextPlayerId = this.net?.id != null ? String(this.net.id) : currentPlayerId;

              if (nextRoomId !== currentRoomId || nextPlayerId !== currentPlayerId) {
                currentRoomId = nextRoomId;
                currentPlayerId = nextPlayerId;
                sendState();
              }

              return origSnapshot.call(this, s, ...rest);
            };

            Object.defineProperty(wrappedSnapshot, '__solsticeIrcPatched', { value: true });
            proto.snapshot = wrappedSnapshot;
          }
        })
        .catch(() => {
          enginePatched = false;
        });
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'irc') {
        return;
      }

      const prevProtect = protectIrc;
      const prevToken = token;
      const prevOrigin = serverOrigin;

      enabled = Boolean(data.enabled);
      protectIrc = data.protectIrc !== false;
      token = String(data.token || '');
      serverOrigin = String(data.serverOrigin || DEFAULT_IRC_ORIGIN);

      if (!enabled || !token) {
        closeSocket();
        return;
      }

      installEngineTracker();

      if (token !== prevToken || serverOrigin !== prevOrigin) {
        closeSocket();
        connectSocket();
      } else {
        connectSocket();
        if (wsConnected && prevProtect !== protectIrc) {
          sendState();
        }
      }
    });

    if (typeof bridge.provide === 'function') {
      bridge.provide('irc', {
        isEnabled: () => enabled && wsConnected,
        isIrcUser: (actor) => Boolean(actor && actor.id != null && peersById.has(String(actor.id))),
        getIrcInfo: (actor) => (actor && actor.id != null ? peersById.get(String(actor.id)) || null : null),
        isProtected: (actor) => {
          if (!enabled || !protectIrc || !actor || actor.id == null) {
            return false;
          }

          const info = peersById.get(String(actor.id));
          return Boolean(info && info.protect);
        }
      });
    }

    bridge.onReset(() => {
      currentRoomId = '';
      peersById.clear();
      sendState();
    });
  }
})();
