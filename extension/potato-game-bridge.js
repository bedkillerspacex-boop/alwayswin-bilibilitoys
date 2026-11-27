(() => {
  'use strict';

  if (window.SolsticeGame?.game === 'potatoepic') {
    return;
  }

  const PARENT_ORIGIN = 'https://www.bilibili.com';
  const configHandlers = new Map();
  const frameCallbacks = [];
  const autoFireRequests = new Set();
  let game = null;
  let gfx = null;
  let hookedGame = null;
  let lastFrameAt = 0;

  function makeVector(x = 0, y = 0, z = 0) {
    return {
      x,
      y,
      z,
      set(nx, ny, nz) {
        this.x = nx;
        this.y = ny;
        this.z = nz;
        return this;
      },
      copy(vector) {
        this.x = Number(vector?.x) || 0;
        this.y = Number(vector?.y) || 0;
        this.z = Number(vector?.z) || 0;
        return this;
      },
      clone() {
        return makeVector(this.x, this.y, this.z);
      },
      project(camera) {
        camera.project(this, this);
        return this;
      }
    };
  }

  function vectorFrom(array) {
    return makeVector(Number(array?.[0]) || 0, Number(array?.[1]) || 0, Number(array?.[2]) || 0);
  }

  function entityPosition(entity) {
    const alpha = Number.isFinite(Number(game?.frameA)) ? Number(game.frameA) : 1;
    const position = typeof entity?.ipos === 'function' ? entity.ipos(alpha) : entity?.pos;
    return vectorFrom(position);
  }

  function entityAimPoint(entity) {
    const position = entityPosition(entity);
    const height = Math.max(0.2, Number(entity?.h) || 1.8);

    let minY = position.y;
    let maxY = position.y + height;

    const box = entityBox(entity);
    if (box) {
      minY = Number(box[1]);
      maxY = Number(box[4]);
    }

    if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY) {
      minY = position.y;
      maxY = position.y + height;
    }

    return makeVector(
      position.x,
      minY + (maxY - minY) * 0.78,
      position.z
    );
  }

  function entityBox(entity) {
    if (typeof entity?.box !== 'function') return null;

    let box;
    try {
      box = entity.box();
    } catch {
      return null;
    }

    if (!Array.isArray(box) || box.length < 6) return null;
    if (!box.every((value) => Number.isFinite(Number(value)))) return null;

    const position = entityPosition(entity);
    const source = entity.pos;
    const dx = position.x - (Number(source?.[0]) || 0);
    const dy = position.y - (Number(source?.[1]) || 0);
    const dz = position.z - (Number(source?.[2]) || 0);

    return [
      Number(box[0]) + dx,
      Number(box[1]) + dy,
      Number(box[2]) + dz,
      Number(box[3]) + dx,
      Number(box[4]) + dy,
      Number(box[5]) + dz
    ];
  }

  function isAlive(entity) {
    if (!entity || entity.dead || Number(entity.deathTime) > 0 || entity.invisible) {
      return false;
    }

    return !(typeof entity.hasEffect === 'function' && entity.hasEffect('invisibility'));
  }

  function playerProxy(entity) {
    return {
      _entity: entity,
      get pos() {
        return entityPosition(entity);
      },
      get yaw() {
        return Number(entity.yaw) || 0;
      },
      set yaw(value) {
        entity.yaw = value;
      },
      get pitch() {
        return Number(entity.pitch) || 0;
      },
      set pitch(value) {
        entity.pitch = value;
      },
      get team() {
        return 0;
      },
      get alive() {
        return isAlive(entity);
      },
      get e() {
        return { h: Number(entity.h) || 1.8 };
      },
      get box() {
        return entityBox(entity);
      },
      get recoilYaw() {
        return Number(entity.recoilYaw) || 0;
      },
      set recoilYaw(value) {
        entity.recoilYaw = Number(value) || 0;
      },
      get recoilPitch() {
        return Number(entity.recoilPitch) || 0;
      },
      set recoilPitch(value) {
        entity.recoilPitch = Number(value) || 0;
      },
      get shake() {
        return Number(entity.shake) || 0;
      },
      set shake(value) {
        entity.shake = Number(value) || 0;
      },
      get gunShake() {
        return Number(entity.gunShake) || 0;
      },
      set gunShake(value) {
        entity.gunShake = Number(value) || 0;
      },
      get kickPitch() {
        return Number(entity.kickPitch) || 0;
      },
      set kickPitch(value) {
        entity.kickPitch = Number(value) || 0;
      },
      get kickRoll() {
        return Number(entity.kickRoll) || 0;
      },
      set kickRoll(value) {
        entity.kickRoll = Number(value) || 0;
      },
      get kickPS() {
        return Number(entity.kickPS) || 0;
      },
      set kickPS(value) {
        entity.kickPS = Number(value) || 0;
      },
      get kickRS() {
        return Number(entity.kickRS) || 0;
      },
      set kickRS(value) {
        entity.kickRS = Number(value) || 0;
      }
    };
  }

  function actorProxy(entity) {
    return {
      _entity: entity,
      get id() {
        if (entity.id != null) return String(entity.id);
        if (entity.eid != null) return String(entity.eid);
        if (entity.peer?.id != null) return String(entity.peer.id);
        const raw = entity.name ?? entity.rawName ?? entity.displayName ?? entity.customName;
        return raw ? String(raw).replace(/\u00a7./g, '').slice(0, 64) : null;
      },
      get isBot() {
        return entity?.type !== 'player';
      },
      get pos() {
        return entityPosition(entity);
      },
      get team() {
        return 1;
      },
      get alive() {
        return isAlive(entity);
      },
      get e() {
        return { h: Number(entity.h) || 1.8 };
      },
      get box() {
        return entityBox(entity);
      },
      get name() {
        const raw = entity.name ?? entity.rawName ?? entity.displayName ?? entity.customName ?? entity.type ?? 'Target';
        return String(raw).replace(/\u00a7./g, '').slice(0, 64);
      },
      get type() {
        return entity.type || 'player';
      },
      get health() {
        const peerHealth = Number(entity.peer?.state?.health);
        if (Number.isFinite(peerHealth)) return peerHealth;

        const value = Number(entity.health);
        return Number.isFinite(value) ? value : 20;
      },
      get maxHealth() {
        const value = Number(entity.maxHealth ?? entity.maxHp);
        return Number.isFinite(value) && value > 0 ? value : 20;
      },
      get absorption() {
        const value = Number(entity.absorption);
        return Number.isFinite(value) ? value : 0;
      },
      get hurtTime() {
        const value = Number(entity.hurtTime);
        return Number.isFinite(value) ? value : 0;
      },
      get look() {
        return entity.look || null;
      },
      get isK9() {
        return false;
      }
    };
  }

  function cameraProxy() {
    return {
      get position() {
        const position = game?.renderer?.camPos;
        if (position) return vectorFrom(position);
        return vectorFrom([
          game?.player?.pos?.[0],
          Number(game?.player?.pos?.[1] || 0) + 1.62,
          game?.player?.pos?.[2]
        ]);
      },
      getWorldDirection(out = makeVector()) {
        if (game?.lookDir) {
          const direction = game.lookDir();
          return out.set(direction[0], direction[1], direction[2]);
        }
        const yaw = Number(game?.player?.yaw) || 0;
        const pitch = Number(game?.player?.pitch) || 0;
        const cos = Math.cos(pitch);
        return out.set(-Math.sin(yaw) * cos, Math.sin(pitch), -Math.cos(yaw) * cos);
      },
      project(point, out = point) {
        const matrix = game?.renderer?.vp;
        if (!matrix) {
          out.x = Infinity;
          out.y = Infinity;
          out.z = -2;
          return out;
        }
        const x = Number(point.x) || 0;
        const y = Number(point.y) || 0;
        const z = Number(point.z) || 0;
        const cx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
        const cy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
        const cz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
        const cw = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
        if (!Number.isFinite(cw) || Math.abs(cw) < 1e-8) {
          out.x = Infinity;
          out.y = Infinity;
          out.z = -2;
          return out;
        }
        out.x = cx / cw;
        out.y = cy / cw;
        out.z = cz / cw;
        return out;
      }
    };
  }

  function remoteActors(player) {
    const actors = [player];
    const seen = new Set();
    for (const entity of game?.entities || []) {
      if (!entity || entity === game.player || entity.dead || Number(entity.deathTime) > 0) {
        continue;
      }
      if (entity.type !== 'player' && entity.xzDummy !== true) {
        continue;
      }
      if (seen.has(entity)) continue;
      seen.add(entity);
      actors.push(actorProxy(entity));
    }
    return actors;
  }

  function ensureGfx() {
    if (gfx) return gfx;
    const render = (...args) => game.render(...args);
    gfx = { camera: cameraProxy(), render };
    const originalRender = game.render;
    gfx.render = (...args) => originalRender.apply(game, args);
    game.render = (...args) => gfx.render(...args);
    return gfx;
  }

  let targetHudShotId = 0;
  let targetHudShotDamage = 0;
  let targetHudShotTarget = '';

  function targetHudTargetId(entity) {
    return String(entity?.id ?? entity?.runtimeId ?? entity?.name ?? '');
  }

  function installXZHooks() {
    const xz = window.XZ;

    if (!xz || typeof xz.onFired !== 'function' || xz.onFired.__solsticeTargetHud) {
      return;
    }

    const original = xz.onFired;

    const wrapped = function solsticeTargetHudFired(firedGame, player, ...args) {
      try {
        const target = window.SolsticeAuraTarget;
        const entity = target?._entity;

        if (firedGame?.player === player && entity) {
          const gun = typeof xz.gun === 'function' ? xz.gun(player.inv?.held) : null;
          const damage = Number(gun?.dmg ?? gun?.damage) || 0;

          if (damage > 0) {
            targetHudShotId++;
            targetHudShotDamage = damage
              * (Number(gun.head) || 2)
              * Math.max(1, Number(gun.pellets) || 1);
            targetHudShotTarget = targetHudTargetId(entity);
          }
        }
      } catch {

      }

      return original.apply(this, arguments);
    };

    Object.defineProperty(wrapped, '__solsticeTargetHud', { value: true });
    xz.onFired = wrapped;
  }

  function installGameHooks() {
    const next = window.game;
    if (!next || next === hookedGame) return;
    game = next;
    hookedGame = next;
    gfx = null;
    ensureGfx();
  }

  function applyAutoFire() {
    if (!game?.mouseBtn) return;
    if (autoFireRequests.size) {
      game.mouseBtn[0] = true;
      game.mouseClicked0 = true;
    } else if (!game.rawMouse?.[0]) {
      game.mouseBtn[0] = false;
    }
  }

  function requestAutoFire(id, enabled) {
    if (typeof id !== 'string') return;
    if (enabled) autoFireRequests.add(id);
    else autoFireRequests.delete(id);
    applyAutoFire();
  }

  function rayAabb(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxDistance) {
    let near = 0;
    let far = Number(maxDistance) || Infinity;
    const origin = [ox, oy, oz];
    const direction = [dx, dy, dz];
    const min = [minX, minY, minZ];
    const max = [maxX, maxY, maxZ];

    for (let axis = 0; axis < 3; axis++) {
      const o = origin[axis];
      const d = direction[axis];
      if (Math.abs(d) < 1e-9) {
        if (o < min[axis] || o > max[axis]) return null;
        continue;
      }
      let t1 = (min[axis] - o) / d;
      let t2 = (max[axis] - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > near) near = t1;
      if (t2 < far) far = t2;
      if (near > far) return null;
    }
    return near >= 0 ? near : null;
  }

  const hudHeadCache = new Map();
  const hudHeadLoading = new Set();
  let lastHudAt = 0;
  let lastHudHiddenAt = 0;
  let lastHudHeadKey = '';
  let lastHudHeadSentAt = 0;

  function cleanTargetName(entity) {
    const raw = entity?.name ?? entity?.rawName ?? entity?.displayName ?? entity?.customName ?? entity?.type ?? 'Target';
    return String(raw).replace(/\u00a7./g, '').slice(0, 64);
  }

  function targetSkin(actor) {
    const entity = actor?._entity;
    if (!entity) return '';

    const own = entity.look?.skin || entity.skinId || (typeof entity.skin === 'string' ? entity.skin : null);
    if (own) return String(own);

    if (entity.type !== 'player') {
      return String(game?.player?.look?.skin || '');
    }

    return '';
  }

  function ensureHudHead(skin) {
    let skins = null;

    try {
      skins = typeof Skins !== 'undefined' ? Skins : window.Skins;
    } catch {

    }

    if (!skins) {
      try {
        skins = window.eval('Skins');
      } catch {

      }
    }

    if (!skin || hudHeadCache.has(skin) || hudHeadLoading.has(skin) || typeof skins?.load !== 'function') {
      return;
    }

    hudHeadLoading.add(skin);

    Promise.resolve(skins.load(skin)).then((source) => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.imageSmoothingEnabled = false;
      context.drawImage(source, 8, 8, 8, 8, 0, 0, 8, 8);
      hudHeadCache.set(skin, canvas.toDataURL('image/png'));
    }).catch(() => {

    }).finally(() => {
      hudHeadLoading.delete(skin);
    });
  }

  function postTargetHud(now) {
    if (window.parent === window) return;

    if (now - lastHudAt < 33) return;
    lastHudAt = now;

    const actor = window.SolsticeAuraTarget;
    const targetAt = Number(window.SolsticeAuraTargetAt) || 0;
    const fresh = Boolean(
      actor &&
      game?.state === 'play' &&
      !game.ui?.screen &&
      now - targetAt < 500
    );

    if (!fresh) {
      if (now - lastHudHiddenAt < 120) return;
      lastHudHiddenAt = now;
      window.parent.postMessage({
        channel: 'solstice-targethud',
        type: 'state',
        hasTarget: false
      }, PARENT_ORIGIN);
      return;
    }

    lastHudHiddenAt = 0;
    const entity = actor._entity;
    const skin = targetSkin(actor);
    const headKey = skin || 'default';
    ensureHudHead(skin);

    const head = hudHeadCache.get(headKey) || hudHeadCache.get(skin) || null;
    let sendHead = null;

    if (head && (headKey !== lastHudHeadKey || now - lastHudHeadSentAt > 2000)) {
      sendHead = head;
      lastHudHeadKey = headKey;
      lastHudHeadSentAt = now;
    }

    const health = Number(actor.health);
    const maxHealth = Number(actor.maxHealth) || 20;
    const healthKnown = Number.isFinite(Number(entity?.peer?.state?.health)) || (entity?.type !== 'player' && Number.isFinite(Number(entity?.health)));
    const localHealth = Number(game?.player?.health) || 0;

    window.parent.postMessage({
      channel: 'solstice-targethud',
      type: 'state',
      hasTarget: true,
      at: now,
      id: String(entity?.id ?? entity?.runtimeId ?? entity?.name ?? headKey),
      name: entity?.type === 'player' ? cleanTargetName(entity) : 'Mob',
      health: Number.isFinite(health) ? health : maxHealth,
      healthKnown,
      maxHealth,
      localHealth,
      absorption: Number(actor.absorption) || 0,
      hurtTime: Number(actor.hurtTime) || 0,
      lastDamage: targetHudShotTarget === targetHudTargetId(entity) ? targetHudShotDamage : 0,
      damageId: targetHudShotTarget === targetHudTargetId(entity) ? targetHudShotId : 0,
      headKey,
      head: sendHead,
      status: localHealth >= health ? 'Winning' : 'Losing'
    }, PARENT_ORIGIN);
  }

  let lastInputAt = 0;

  function postInputState(now) {
    if (window.parent === window || now - lastInputAt < 50) {
      return;
    }

    lastInputAt = now;
    const keys = game?.keys || {};
    const playing = Boolean(game?.state === 'play' && !game?.ui?.screen);
    const w = Boolean(keys.KeyW || keys.w || keys.ArrowUp);
    const a = Boolean(keys.KeyA || keys.a || keys.ArrowLeft);
    const s = Boolean(keys.KeyS || keys.s || keys.ArrowDown);
    const d = Boolean(keys.KeyD || keys.d || keys.ArrowRight);
    const space = Boolean(keys.Space || keys[' '] || keys.space);

    window.parent.postMessage({
      channel: 'solstice-input',
      type: 'state',
      w: playing && w,
      a: playing && a,
      s: playing && s,
      d: playing && d,
      space: playing && space,
      playing
    }, PARENT_ORIGIN);
  }

  function runFrame(now) {
    const dt = lastFrameAt ? Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000)) : 1 / 60;
    lastFrameAt = now;
    postTargetHud(now);
    postInputState(now);

    if (game?.state === 'play' && !game.ui?.screen) {
      for (const callback of frameCallbacks) {
        try {
          callback(dt);
        } catch {

        }
      }
    }
    requestAnimationFrame(runFrame);
  }

  function getGH() {
    if (!game || !isAlive(game.player)) return null;
    const player = playerProxy(game.player);
    return {
      ready: true,
      G: { state: game.state === 'play' ? 'playing' : game.state },
      debug: {
        gfx: ensureGfx(),
        player,
        match: { actors: remoteActors(player) }
      }
    };
  }

  function getContext() {
    if (!game || !isAlive(game.player)) return null;
    const player = playerProxy(game.player);
    return {
      player,
      camera: cameraProxy(),
      input: {
        mx: 0,
        my: 0,
        held(name) {
          if (name === 'Mouse2') return Boolean(game.mouseBtn?.[2]);
          if (name === 'Mouse0') return Boolean(game.mouseBtn?.[0]);
          return Boolean(game.keys?.[name]);
        }
      },
      actors: remoteActors(player)
    };
  }

  function onConfig(channel, callback) {
    if (typeof channel !== 'string' || typeof callback !== 'function') return;
    let handlers = configHandlers.get(channel);
    if (!handlers) configHandlers.set(channel, handlers = new Set());
    handlers.add(callback);
  }

  function onBeforePlayerUpdate(callback) {
    if (typeof callback === 'function') frameCallbacks.push(callback);
    installGameHooks();
  }

  function onBeforeArsenalUpdate(callback) {
    if (typeof callback === 'function') frameCallbacks.push(callback);
    installGameHooks();
  }

  function isEnemy(actor, player) {
    return Boolean(
      actor &&
      player &&
      actor !== player &&
      actor._entity !== game?.player &&
      actor._entity?.xzMate !== true &&
      actor.alive !== false
    );
  }

  function headPoint(actor, out = makeVector()) {
    const entity = actor?._entity;
    if (!entity) return out.set(0, 0, 0);
    const aim = entityAimPoint(entity);
    return out.set(aim.x, aim.y, aim.z);
  }

  function worldLineClear(origin, end) {
    if (!game?.raycast) return true;
    const dx = end.x - origin.x;
    const dy = end.y - origin.y;
    const dz = end.z - origin.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 0.01) return true;
    try {
      const hit = game.raycast(
        [origin.x, origin.y, origin.z],
        [dx / distance, dy / distance, dz / distance],
        distance,
        false,
        true
      );
      return !hit || Number(hit.t) >= distance - 0.1;
    } catch {
      return true;
    }
  }

  const features = new Map();
  const resetHooks = [];

  function provide(name, value) {
    if (typeof name === 'string' && name) {
      features.set(name, value);
    }
  }

  function getFeature(name) {
    return typeof name === 'string' ? (features.get(name) ?? null) : null;
  }

  function onReset(hook) {
    if (typeof hook === 'function') {
      resetHooks.push(hook);
    }
  }

  const bridge = {
    game: 'potatoepic',
    active: true,
    onConfig,
    onBeforePlayerUpdate,
    onBeforeArsenalUpdate,
    onReset,
    requestAutoFire,
    rayAabb,
    getContext,
    getGH,
    isEnemy,
    headPoint,
    worldLineClear,
    provide,
    getFeature,
    clamp(value, min, max) {
      const number = Number(value);
      return Math.max(min, Math.min(max, Number.isFinite(number) ? number : min));
    },
    wrapAngle(value) {
      let angle = Number(value) || 0;
      while (angle > Math.PI) angle -= Math.PI * 2;
      while (angle < -Math.PI) angle += Math.PI * 2;
      return angle;
    }
  };

  Object.defineProperty(bridge, 'physicalRmb', {
    get() {
      return Boolean(game?.mouseBtn?.[2]);
    }
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== PARENT_ORIGIN || !event.data || typeof event.data !== 'object') {
      return;
    }
    const data = event.data;
    const handlers = configHandlers.get(data.channel);
    if (!handlers) return;
    for (const callback of handlers) {
      try {
        callback(data);
      } catch {

      }
    }
  });

  function installAntiCheatSink() {
    if (typeof WebSocket !== 'function' || WebSocket.__solsticeIcSink) {
      return;
    }

    const NativeWebSocket = WebSocket;
    const cleanXz = new Map();
    let cleanXzObject = null;

    function captureCleanXz() {
      const xz = window.XZ;

      if (!xz) {
        return;
      }

      if (cleanXzObject !== xz) {
        cleanXzObject = xz;
        cleanXz.clear();

        for (const key of Object.getOwnPropertyNames(xz)) {
          let value;

          try {
            value = xz[key];
          } catch {
            continue;
          }

          if (typeof value === 'function') {
            cleanXz.set(key, value);
          }
        }
      }

      if (typeof window.__solsticeOnFiredBase === 'function') {
        cleanXz.set('onFired', window.__solsticeOnFiredBase);
      }
    }

    function withCleanXzFunctions() {
      const xz = window.XZ;

      if (!xz || xz !== cleanXzObject) {
        return () => {};
      }

      const saved = [];

      for (const [key, clean] of cleanXz) {
        let descriptor;

        try {
          descriptor = Object.getOwnPropertyDescriptor(xz, key);
        } catch {
          continue;
        }

        if (!descriptor || descriptor.value === clean) {
          continue;
        }

        try {
          Object.defineProperty(xz, key, {
            configurable: true,
            writable: true,
            value: clean
          });
          saved.push([key, descriptor]);
        } catch {

        }
      }

      return () => {
        for (let index = saved.length - 1; index >= 0; index--) {
          const [key, descriptor] = saved[index];

          try {
            Object.defineProperty(xz, key, descriptor);
          } catch {

          }
        }
      };
    }

    function isDetectionKey(key) {
      return typeof key === 'string' && /^(?:pre|n|ref|mark|dom|xz|prop|data|cheat|dev):/.test(key);
    }

    function isIcqEvent(event) {
      if (typeof event?.data !== 'string' || !event.data.includes('"icq"')) {
        return false;
      }

      try {
        return JSON.parse(event.data)?.t === 'icq';
      } catch {
        return false;
      }
    }

    function withCleanFindings(handler, thisArg, event) {
      const nativeSlice = Array.prototype.slice;
      const nativeJoin = Array.prototype.join;
      const nativeOwnNames = Object.getOwnPropertyNames;
      const restoreXz = withCleanXzFunctions();
      const hiddenDom = [];
      const hiddenStorage = [];
      const solsticeName = /solstice/i;

      try {
        for (const element of document.querySelectorAll('[id*="solstice" i], [class*="solstice" i]')) {
          const parent = element.parentNode;

          if (!parent || !element.isConnected) {
            continue;
          }

          hiddenDom.push({ element, parent, next: element.nextSibling });
          parent.removeChild(element);
        }
      } catch {

      }

      try {
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index);

          if (!key || !solsticeName.test(key)) {
            continue;
          }

          hiddenStorage.push([key, localStorage.getItem(key)]);
          localStorage.removeItem(key);
          index--;
        }
      } catch {

      }

      Object.getOwnPropertyNames = function getOwnPropertyNames(target) {
        return nativeOwnNames.call(Object, target)
          .filter((name) => typeof name !== 'string' || !solsticeName.test(name));
      };

      Array.prototype.slice = function slice(start, end) {
        const result = nativeSlice.call(this, start, end);

        if (Array.isArray(result) && result.length && result.every(isDetectionKey)) {
          return result.filter((key) => !isDetectionKey(key));
        }

        return result;
      };

      Array.prototype.join = function join(separator) {
        if (Array.isArray(this) && this.length && this.every(isDetectionKey)) {
          return '';
        }

        return nativeJoin.call(this, separator);
      };

      try {
        return handler.call(thisArg, event);
      } finally {
        Array.prototype.slice = nativeSlice;
        Array.prototype.join = nativeJoin;
        Object.getOwnPropertyNames = nativeOwnNames;

        for (const { element, parent, next } of hiddenDom) {
          try {
            parent.insertBefore(element, next && next.parentNode === parent ? next : null);
          } catch {

          }
        }

        for (const [key, value] of hiddenStorage) {
          try {
            if (value === null) {
              localStorage.removeItem(key);
            } else {
              localStorage.setItem(key, value);
            }
          } catch {

          }
        }

        restoreXz();
      }
    }

    const nativeOnMessage = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, 'onmessage');
    const messageHandlers = new WeakMap();

    if (nativeOnMessage?.get && nativeOnMessage?.set) {
      try {
        Object.defineProperty(NativeWebSocket.prototype, 'onmessage', {
          configurable: true,
          enumerable: true,
          get() {
            return messageHandlers.get(this) ?? nativeOnMessage.get.call(this);
          },
          set(handler) {
            if (typeof handler !== 'function') {
              messageHandlers.delete(this);
              nativeOnMessage.set.call(this, handler);
              return;
            }

            messageHandlers.set(this, handler);
            nativeOnMessage.set.call(this, function onMessage(event) {
              if (!isIcqEvent(event)) {
                return handler.call(this, event);
              }

              return withCleanFindings(handler, this, event);
            });
          }
        });
      } catch {

      }
    }

    const PatchedWebSocket = function SolsticeWebSocket(...args) {
      const socket = new NativeWebSocket(...args);
      const nativeSend = socket.send;

      Object.defineProperty(socket, 'send', {
        configurable: true,
        value: function send(data) {
          if (typeof data === 'string' && data.includes('"ic"')) {
            try {
              if (JSON.parse(data)?.t === 'ic') {
                return undefined;
              }
            } catch {

            }
          }

          return nativeSend.call(socket, data);
        }
      });

      return socket;
    };

    PatchedWebSocket.prototype = NativeWebSocket.prototype;

    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      if (key in NativeWebSocket) {
        PatchedWebSocket[key] = NativeWebSocket[key];
      }
    }

    try {
      Object.setPrototypeOf(PatchedWebSocket, NativeWebSocket);
    } catch {

    }

    Object.defineProperty(PatchedWebSocket, '__solsticeIcSink', { value: true });
    window.WebSocket = PatchedWebSocket;
    captureCleanXz();
    setInterval(captureCleanXz, 5);
  }

  installAntiCheatSink();

  window.SolsticeGame = bridge;
  installGameHooks();
  setInterval(installGameHooks, 250);
  window.requestAnimationFrame(runFrame);
})();
