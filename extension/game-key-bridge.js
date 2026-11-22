(() => {
  'use strict';

  const CHANNEL = 'solstice-game';
  const INPUT_CHANNEL = 'solstice-input';
  const KEY_CHANNEL = 'solstice-key';
  const PARENT_ORIGIN = 'https://www.bilibili.com';
  const RETRY_INTERVAL_MS = 250;
  const MAX_ANNOUNCES = 40;

  let active = false;
  let uiOpen = false;
  let announces = 0;
  let timer = 0;
  let physicalLmb = false;
  let physicalRmb = false;
  let physicalShiftLeft = false;
  let physicalShiftRight = false;
  let physicalSpace = false;
  let physicalW = false;
  let physicalA = false;
  let physicalS = false;
  let physicalD = false;
  let syntheticLmb = false;
  let latestOnlineWorld = null;
  let latestOnlineWorldAt = 0;
  let latestOnlineJumpHeld = false;
  let latestRawSnapshot = null;
  let latestRawSnapshotAt = 0;
  let latestSelfId = null;
  let latestEngine = null;
  let engineSnapshotHooked = false;
  let overlayMinIntervalMs = 1000 / 60;
  let maxDpr = 1.5;

  function installEngineSnapshotHook() {
    if (engineSnapshotHooked) {
      return;
    }

    engineSnapshotHooked = true;
    const engineUrl = new URL('client/engine.js', location.href).href;

    import(engineUrl)
      .then(({ Engine }) => {
        const proto = Engine?.prototype;

        if (!proto || typeof proto.snapshot !== 'function' || proto.snapshot.__solsticeBridgeSnapshotHooked) {
          return;
        }

        const originalSnapshot = proto.snapshot;
        const wrappedSnapshot = function wrappedBridgeSnapshot(s, ...rest) {
          latestEngine = this;
          if (s && Array.isArray(s.players)) {
            latestRawSnapshot = s;
            latestRawSnapshotAt = performance.now();
            if (this.net?.id != null) {
              latestSelfId = this.net.id;
            }
          }

          return originalSnapshot.call(this, s, ...rest);
        };

        Object.defineProperty(wrappedSnapshot, '__solsticeBridgeSnapshotHooked', { value: true });
        proto.snapshot = wrappedSnapshot;
      })
      .catch(() => {
        engineSnapshotHooked = false;
      });
  }

  function getRawSnapshot() {
    if (!latestRawSnapshot || performance.now() - latestRawSnapshotAt > 1000) {
      return null;
    }

    return latestRawSnapshot;
  }

  function getRawPlayer(actor) {
    const snap = getRawSnapshot();

    if (!snap || !actor || actor.id == null) {
      return null;
    }

    return snap.players.find((p) => p && p.id === actor.id) || null;
  }

  function getRawSelf() {
    const snap = getRawSnapshot();

    if (!snap || latestSelfId == null) {
      return null;
    }

    return snap.players.find((p) => p && p.id === latestSelfId) || null;
  }

  function getEngineState() {
    if (!latestEngine || !latestEngine.active) {
      return null;
    }

    return {
      engine: latestEngine,
      world: latestEngine.world || null,
      predicted: latestEngine.predicted || null,
      latestTick: latestRawSnapshot?.tick ?? null
    };
  }

  function getEngineSnapshots() {
    if (!latestEngine || !latestEngine.active || !Array.isArray(latestEngine.snapshots)) {
      return null;
    }

    return latestEngine.snapshots;
  }

  let shotTickOverride = null;
  let shotTickOverrideUntil = 0;

  function setShotTickOverride(tick, ttlMs = 150) {
    const num = Number(tick);

    if (Number.isFinite(num) && num > 0) {
      shotTickOverride = Math.round(num);
      shotTickOverrideUntil = performance.now() + Math.max(20, Number(ttlMs) || 150);
    } else {
      shotTickOverride = null;
      shotTickOverrideUntil = 0;
    }
  }

  function installShotTickFix() {
    function rewrite(data) {
      if (!active) {
        return data;
      }

      const snapshot = getRawSnapshot();
      const hasOverride = shotTickOverride !== null && performance.now() <= shotTickOverrideUntil;
      const targetTick = hasOverride ? shotTickOverride : snapshot?.tick;

      if (!Number.isFinite(targetTick) || targetTick <= 0) {
        return data;
      }

      if (typeof data === 'string') {
        if (
          !data.includes('"type":"shot"') &&
          !data.includes('"type": "shot"') &&
          !data.includes('"type":"melee"') &&
          !data.includes('"type": "melee"')
        ) {
          return data;
        }

        try {
          const message = JSON.parse(data);

          if (!message || (message.type !== 'shot' && message.type !== 'melee')) {
            return data;
          }

          message.tick = targetTick;
          return JSON.stringify(message) + (data.endsWith('\n') ? '\n' : '');
        } catch {
          return data;
        }
      }

      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        const bytes = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

        if (bytes.byteLength > 16384 || bytes[0] !== 0x7b) {
          return data;
        }

        try {
          const text = new TextDecoder().decode(bytes);
          const message = JSON.parse(text);

          if (!message || (message.type !== 'shot' && message.type !== 'melee')) {
            return data;
          }

          message.tick = targetTick;
          return new TextEncoder().encode(JSON.stringify(message) + (text.endsWith('\n') ? '\n' : ''));
        } catch {
          return data;
        }
      }

      return data;
    }

    function install() {
      if (typeof WebSocket === 'function' && !WebSocket.prototype.send.__solsticeShotTick) {
        const original = WebSocket.prototype.send;
        const send = function send(data) {
          return original.call(this, rewrite(data));
        };

        Object.defineProperty(send, '__solsticeShotTick', { value: true });
        WebSocket.prototype.send = send;
      }

      if (typeof RTCDataChannel === 'function' && !RTCDataChannel.prototype.send.__solsticeShotTick) {
        const original = RTCDataChannel.prototype.send;
        const send = function send(data) {
          return original.call(this, rewrite(data));
        };

        Object.defineProperty(send, '__solsticeShotTick', { value: true });
        RTCDataChannel.prototype.send = send;
      }

      if (typeof WritableStreamDefaultWriter === 'function' && !WritableStreamDefaultWriter.prototype.write.__solsticeShotTick) {
        const original = WritableStreamDefaultWriter.prototype.write;
        const write = function write(chunk) {
          return original.call(this, rewrite(chunk));
        };

        Object.defineProperty(write, '__solsticeShotTick', { value: true });
        WritableStreamDefaultWriter.prototype.write = write;
      }
    }

    install();
    setInterval(install, 500);
  }
  let lastInputState = '';
  let guardSwallow = true;
  let guardMouse = true;

  const autoFireRequests = new Set();
  const recoilSuppressors = new Set();
  const playerHooks = [];
  const arsenalBeforeHooks = [];
  const arsenalAfterHooks = [];
  const worldHooks = [];
  const fireHooks = [];
  const meleeHooks = [];
  const resetHooks = [];
  const configHandlers = new Map();
  const features = new Map();

  function send(type, payload) {
    const message = { channel: CHANNEL, type };

    if (payload) {
      Object.assign(message, payload);
    }

    try {
      window.parent.postMessage(message, PARENT_ORIGIN);
    } catch {

    }
  }

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function addHook(list, hook, priority = 0) {
    list.push({ hook, priority });
    list.sort((a, b) => a.priority - b.priority);
  }

  function runHooks(list, ...args) {
    for (const entry of list) {
      try {
        entry.hook(...args);
      } catch {

      }
    }
  }

  function onConfig(channel, handler) {
    if (!configHandlers.has(channel)) {
      configHandlers.set(channel, new Set());
    }

    configHandlers.get(channel).add(handler);
  }

  function onMessage(event) {
    if (event.origin !== PARENT_ORIGIN || event.source !== window.parent) {
      return;
    }

    const data = event.data;

    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.channel === 'solstice-input-guard') {
      if (data.type === 'guard') {
        guardSwallow = data.swallow !== false;
        guardMouse = data.mouse !== false;
      }

      return;
    }

    if (data.channel === CHANNEL) {
      if (data.type === 'ack') {
        active = true;
        uiOpen = Boolean(data.open);

        if (timer) {
          clearInterval(timer);
          timer = 0;
        }
      } else if (data.type === 'state') {
        uiOpen = Boolean(data.open);
      }

      return;
    }

    if (data.channel === 'solstice-hud-settings') {
      const fps = data.active ? Math.max(15, Math.min(144, Number(data.overlayFps) || 60)) : 144;
      overlayMinIntervalMs = data.active ? (1000 / fps) : 0;
      maxDpr = data.active ? Math.max(0.75, Math.min(2, Number(data.maxDpr) || 1.5)) : 2;
      return;
    }

    const handlers = configHandlers.get(data.channel);

    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch {

        }
      }
    }
  }

  function onKeyDown(event) {
    if (!active) {
      return;
    }

    const isInsert = event.code === 'Insert' || event.key === 'Insert';

    if (isInsert) {
      consume(event);

      if (!event.repeat) {
        send('toggle');
      }

      return;
    }

    const isEscape = event.code === 'Escape' || event.key === 'Escape';

    if (isEscape && uiOpen) {
      consume(event);

      if (!event.repeat) {
        send('close');
      }
    }
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function wrapAngle(value) {
    while (value > Math.PI) {
      value -= Math.PI * 2;
    }

    while (value < -Math.PI) {
      value += Math.PI * 2;
    }

    return value;
  }

  function combatContext() {
    if (!active || uiOpen) {
      return null;
    }

    const gh = window.GH;

    if (!gh?.ready || gh.G?.state !== 'playing') {
      return null;
    }

    const debug = gh.debug;
    const player = debug?.player;
    const camera = debug?.gfx?.camera;
    const input = debug?.input;
    const actors = debug?.match?.actors;

    if (!player?.alive || !player?.pos || !camera || !input || !Array.isArray(actors)) {
      return null;
    }

    return { gh, debug, player, camera, input, actors };
  }

  function headPoint(actor, out) {
    const parts = actor.hit;

    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part?.part === 'head' && part.a && part.b) {
          out.set(
            (part.a.x + part.b.x) * 0.5,
            (part.a.y + part.b.y) * 0.5,
            (part.a.z + part.b.z) * 0.5
          );
          return out;
        }
      }
    }

    const height = Number(actor.e?.h) > 0.2 ? Number(actor.e.h) : 1.8;
    out.set(actor.pos.x, actor.pos.y + height - 0.12, actor.pos.z);
    return out;
  }

  function isEnemy(actor, player) {
    if (
      !actor ||
      actor === player ||
      !actor.pos ||
      actor.alive === false ||
      actor.isK9 ||
      Number(actor.team) === Number(player.team)
    ) {
      return false;
    }

    const irc = getFeature('irc');

    if (irc && typeof irc.isProtected === 'function' && irc.isProtected(actor)) {
      return false;
    }

    return true;
  }

  function worldRayDistance(from, to) {
    if (!from || !to) {
      return null;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);

    if (length < 1e-4) {
      return null;
    }

    const dir = { x: dx / length, y: dy / length, z: dz / length };
    const online = document.body.classList.contains('online-session') &&
      latestOnlineWorld &&
      typeof latestOnlineWorld.raycast === 'function' &&
      performance.now() - latestOnlineWorldAt < 1000;

    if (online) {
      const hit = latestOnlineWorld.raycast(from, dir, length);
      return hit && Number.isFinite(hit.distance) ? hit.distance : null;
    }

    const world = window.GH?.debug?.world;

    if (typeof world?.raycast === 'function') {
      const out = { t: length };
      const hit = world.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, length, out);

      if (hit && Number.isFinite(out.t)) {
        return out.t;
      }
    }

    return null;
  }

  function worldLineClear(from, to) {
    if (!from || !to) {
      return true;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);

    if (length < 1e-4) {
      return true;
    }

    const online = document.body.classList.contains('online-session') &&
      latestOnlineWorld &&
      typeof latestOnlineWorld.raycast === 'function' &&
      performance.now() - latestOnlineWorldAt < 1000;

    if (online) {
      return !latestOnlineWorld.raycast(
        from,
        { x: dx / length, y: dy / length, z: dz / length },
        Math.max(0, length - 0.02)
      );
    }

    const world = window.GH?.debug?.world;

    if (typeof world?.clear === 'function') {
      return world.clear(from, to);
    }

    return true;
  }

  function rayAabb(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxDistance) {
    let tMin = 0;
    let tMax = maxDistance;
    const origin = [ox, oy, oz];
    const direction = [dx, dy, dz];
    const minima = [minX, minY, minZ];
    const maxima = [maxX, maxY, maxZ];

    for (let axis = 0; axis < 3; axis += 1) {
      if (Math.abs(direction[axis]) < 1e-9) {
        if (origin[axis] < minima[axis] || origin[axis] > maxima[axis]) {
          return null;
        }

        continue;
      }

      let first = (minima[axis] - origin[axis]) / direction[axis];
      let second = (maxima[axis] - origin[axis]) / direction[axis];

      if (first > second) {
        const swap = first;
        first = second;
        second = swap;
      }

      tMin = Math.max(tMin, first);
      tMax = Math.min(tMax, second);

      if (tMin > tMax) {
        return null;
      }
    }

    if (tMax < 0) {
      return null;
    }

    return Math.max(0, tMin);
  }

  function nearestEnemy(player, actors) {
    let best = null;
    let bestDistance = Infinity;

    for (const actor of actors) {
      if (!isEnemy(actor, player)) {
        continue;
      }

      const distance = Math.hypot(
        actor.pos.x - player.pos.x,
        actor.pos.y - player.pos.y,
        actor.pos.z - player.pos.z
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        best = actor;
      }
    }

    return best;
  }

  function releaseSyntheticFire() {
    if (!syntheticLmb) {
      return;
    }

    syntheticLmb = false;

    if (physicalLmb) {
      return;
    }

    const input = window.GH?.debug?.input;

    if (input) {
      input.keys?.delete('Mouse0');
      input.down?.delete('Mouse0');
    }
  }

  function setSyntheticFire(wanted) {
    const input = window.GH?.debug?.input;

    if (!wanted || !input || physicalLmb) {
      if (syntheticLmb) {
        releaseSyntheticFire();
      }

      return;
    }

    input.keys?.add('Mouse0');
    input.down?.add('Mouse0');
    syntheticLmb = true;
  }

  function syncSyntheticFire() {
    setSyntheticFire(autoFireRequests.size > 0);
  }

  function requestAutoFire(source, wanted) {
    if (wanted) {
      autoFireRequests.add(source);
    } else {
      autoFireRequests.delete(source);
    }

    syncSyntheticFire();
  }

  function clearAutoFireRequests() {
    autoFireRequests.clear();
    setSyntheticFire(false);
  }

  function setRecoilSuppressed(source, wanted) {
    if (wanted) {
      recoilSuppressors.add(source);
    } else {
      recoilSuppressors.delete(source);
    }
  }

  function isRecoilSuppressed() {
    return recoilSuppressors.size > 0;
  }

  function provide(name, value) {
    features.set(name, value);
  }

  function getFeature(name) {
    return features.get(name) || null;
  }

  function resetRuntime() {
    physicalLmb = false;
    physicalRmb = false;
    physicalShiftLeft = false;
    physicalShiftRight = false;
    physicalSpace = false;
    physicalW = false;
    physicalA = false;
    physicalS = false;
    physicalD = false;
    clearAutoFireRequests();
    runHooks(resetHooks);
  }

  function sendInputState() {
    const playing = Boolean(active && !uiOpen && window.GH?.G?.state === 'playing');
    const vel = window.GH?.debug?.player?.vel;
    const rawSelf = playing ? getRawSelf() : null;
    const speed = playing && vel ? Math.round(Math.hypot(Number(vel.x) || 0, Number(vel.z) || 0) * 100) / 100 : 0;
    const serverSpeed = rawSelf ? Math.round(Math.hypot(Number(rawSelf.vx) || 0, Number(rawSelf.vz) || 0) * 100) / 100 : 0;
    const aura = playing ? features.get('aura') : null;
    const melee = playing ? features.get('meleeaura') : null;
    const auraTarget = aura && typeof aura.getTargetInfo === 'function' ? aura.getTargetInfo() : null;
    const meleeReady = Boolean(melee && typeof melee.isReady === 'function' && melee.isReady());

    const state = {
      channel: INPUT_CHANNEL,
      type: 'state',
      w: active && !uiOpen && physicalW,
      a: active && !uiOpen && physicalA,
      s: active && !uiOpen && physicalS,
      d: active && !uiOpen && physicalD,
      space: active && !uiOpen && physicalSpace,
      playing,
      speed,
      serverSpeed,
      slideCooldown: rawSelf ? Math.round((Number(rawSelf.slideCooldown) || 0) * 100) / 100 : 0,
      sliding: Boolean(rawSelf?.sliding),
      auraTarget,
      meleeReady
    };
    const key = JSON.stringify(state);

    if (key === lastInputState) {
      return;
    }

    lastInputState = key;

    try {
      window.parent.postMessage(state, PARENT_ORIGIN);
    } catch {

    }
  }

  function installHooks() {
    const debug = window.GH?.debug;

    if (!debug) {
      return;
    }

    const player = debug.player;

    if (player && typeof player.update === 'function' && !player.update.__solsticeRuntimePlayerHooked) {
      const originalUpdate = player.update;
      const wrappedUpdate = function wrappedSolsticePlayerUpdate(...args) {
        runHooks(playerHooks, args[0]);
        return originalUpdate.apply(this, args);
      };

      Object.defineProperty(wrappedUpdate, '__solsticeRuntimePlayerHooked', { value: true });
      player.update = wrappedUpdate;
    }

    const arsenal = debug.arsenal;

    if (arsenal && typeof arsenal.update === 'function' && !arsenal.update.__solsticeRuntimeArsenalHooked) {
      const originalUpdate = arsenal.update;
      const wrappedUpdate = function wrappedSolsticeArsenalUpdate(...args) {
        runHooks(arsenalBeforeHooks);
        const result = originalUpdate.apply(this, args);
        runHooks(arsenalAfterHooks);
        return result;
      };

      Object.defineProperty(wrappedUpdate, '__solsticeRuntimeArsenalHooked', { value: true });
      arsenal.update = wrappedUpdate;
    }

    const combat = debug.ctx?.combat || debug.combat;

    if (combat && typeof combat.fire === 'function' && !combat.fire.__solsticeRuntimeFireHooked) {
      const originalFire = combat.fire;
      const wrappedFire = function wrappedSolsticeCombatFire(...args) {
        let direction = args[2];

        for (const entry of fireHooks) {
          try {
            const replacement = entry.hook(args[0], args[1], direction, ...args.slice(3));
            if (replacement) {
              direction = replacement;
            }
          } catch {

          }
        }

        args[2] = direction;
        return originalFire.apply(this, args);
      };

      Object.defineProperty(wrappedFire, '__solsticeRuntimeFireHooked', { value: true });
      combat.fire = wrappedFire;
    }

    if (combat && typeof combat.melee === 'function' && !combat.melee.__solsticeRuntimeMeleeHooked) {
      const originalMelee = combat.melee;
      const wrappedMelee = function wrappedSolsticeCombatMelee(...args) {
        let direction = args[2];

        for (const entry of meleeHooks) {
          try {
            const replacement = entry.hook(args[0], args[1], direction, ...args.slice(3));
            if (replacement) {
              direction = replacement;
            }
          } catch {

          }
        }

        args[2] = direction;
        return originalMelee.apply(this, args);
      };

      Object.defineProperty(wrappedMelee, '__solsticeRuntimeMeleeHooked', { value: true });
      combat.melee = wrappedMelee;
    }
  }

  let worldPatched = false;

  function installWorldPatch() {
    if (worldPatched) {
      return;
    }

    worldPatched = true;
    const moduleUrl = new URL('client/simulation.js', location.href).href;

    import(moduleUrl).then(({ World }) => {
      const prototype = World?.prototype;

      if (!prototype || typeof prototype.move !== 'function' || prototype.move.__solsticeRuntimeWorldHooked) {
        return;
      }

      const originalMove = prototype.move;
      const wrappedMove = function wrappedSolsticeWorldMove(motionState, input) {
        if (document.body.classList.contains('online-session')) {
          latestOnlineWorld = this;
          latestOnlineWorldAt = performance.now();
          latestOnlineJumpHeld = Boolean(motionState.jumpHeld);
        }

        const context = { motionState, input, localInput: input };

        for (const entry of worldHooks) {
          try {
            entry.hook(context);
          } catch {

          }
        }

        return originalMove.call(this, motionState, context.localInput);
      };

      Object.defineProperty(wrappedMove, '__solsticeRuntimeWorldHooked', { value: true });
      prototype.move = wrappedMove;
    }).catch(() => {
      worldPatched = false;
    });
  }

  function announce() {
    if (active) {
      return;
    }

    send('hello');
    announces += 1;

    if (announces >= MAX_ANNOUNCES && timer) {
      clearInterval(timer);
      timer = 0;
    }
  }

  window.SolsticeGame = {
    get active() {
      return active;
    },
    get uiOpen() {
      return uiOpen;
    },
    get physicalLmb() {
      return physicalLmb;
    },
    get physicalRmb() {
      return physicalRmb;
    },
    get physicalShiftLeft() {
      return physicalShiftLeft;
    },
    get physicalShiftRight() {
      return physicalShiftRight;
    },
    get physicalSpace() {
      return physicalSpace;
    },
    get latestOnlineJumpHeld() {
      return latestOnlineJumpHeld;
    },
    get overlayMinIntervalMs() {
      return overlayMinIntervalMs;
    },
    get maxDpr() {
      return maxDpr;
    },
    getGH() {
      return window.GH;
    },
    onConfig,
    onBeforePlayerUpdate(hook, priority = 0) {
      addHook(playerHooks, hook, priority);
    },
    onBeforeArsenalUpdate(hook, priority = 0) {
      addHook(arsenalBeforeHooks, hook, priority);
    },
    onAfterArsenalUpdate(hook, priority = 0) {
      addHook(arsenalAfterHooks, hook, priority);
    },
    onWorldMove(hook, priority = 0) {
      addHook(worldHooks, hook, priority);
    },
    onCombatFire(hook, priority = 0) {
      addHook(fireHooks, hook, priority);
    },
    onCombatMelee(hook, priority = 0) {
      addHook(meleeHooks, hook, priority);
    },
    onReset(hook) {
      resetHooks.push(hook);
    },
    getContext: combatContext,
    isEnemy,
    headPoint,
    getRawSnapshot,
    getRawPlayer,
    getRawSelf,
    getEngineState,
    getEngineSnapshots,
    setShotTickOverride,
    worldLineClear,
    worldRayDistance,
    rayAabb,
    nearestEnemy,
    clamp,
    wrapAngle,
    requestAutoFire,
    clearAutoFireRequests,
    setRecoilSuppressed,
    isRecoilSuppressed,
    provide,
    getFeature
  };

  window.addEventListener('message', onMessage);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keydown', (event) => {
    if (event.code === 'ShiftLeft') {
      physicalShiftLeft = true;
    } else if (event.code === 'ShiftRight') {
      physicalShiftRight = true;
    } else if (event.code === 'Space') {
      physicalSpace = true;
    } else if (event.code === 'KeyW') {
      physicalW = true;
    } else if (event.code === 'KeyA') {
      physicalA = true;
    } else if (event.code === 'KeyS') {
      physicalS = true;
    } else if (event.code === 'KeyD') {
      physicalD = true;
    }

    if (guardSwallow && (event.ctrlKey || event.altKey || event.metaKey)) {
      /* 游戏里按住 Ctrl / Alt / Win 时直接吞掉，Edge 收不到就不会触发快捷动作 */
      consume(event);
      return;
    }

    if (
      active &&
      !event.repeat &&
      event.code !== 'Insert' &&
      event.code !== 'Escape'
    ) {
      try {
        window.parent.postMessage({
          channel: KEY_CHANNEL,
          type: 'down',
          code: event.code || event.key,
          key: event.key,
          ctrl: Boolean(event.ctrlKey),
          alt: Boolean(event.altKey),
          shift: Boolean(event.shiftKey),
          meta: Boolean(event.metaKey)
        }, PARENT_ORIGIN);
      } catch {

      }
    }
  }, true);
  window.addEventListener('keyup', (event) => {
    if (event.code === 'ShiftLeft') {
      physicalShiftLeft = false;
    } else if (event.code === 'ShiftRight') {
      physicalShiftRight = false;
    } else if (event.code === 'Space') {
      physicalSpace = false;
    } else if (event.code === 'KeyW') {
      physicalW = false;
    } else if (event.code === 'KeyA') {
      physicalA = false;
    } else if (event.code === 'KeyS') {
      physicalS = false;
    } else if (event.code === 'KeyD') {
      physicalD = false;
    }
  }, true);
  window.addEventListener('mousedown', (event) => {
    if (event.button === 0) {
      physicalLmb = true;
    } else if (event.button === 2) {
      physicalRmb = true;
    }

    if (!guardMouse || !active) {
      return;
    }

    const code = event.button === 1
      ? 'Mouse3'
      : event.button === 3
        ? 'Mouse4'
        : event.button === 4
          ? 'Mouse5'
          : '';

    if (!code) {
      return;
    }

    try {
      window.parent.postMessage({
        channel: KEY_CHANNEL,
        type: 'down',
        code,
        key: code,
        ctrl: Boolean(event.ctrlKey),
        alt: Boolean(event.altKey),
        shift: Boolean(event.shiftKey),
        meta: Boolean(event.metaKey)
      }, PARENT_ORIGIN);
    } catch {

    }

    if (!uiOpen) {
      consume(event);
    }
  }, true);
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) {
      physicalLmb = false;

      if (syntheticLmb) {
        syntheticLmb = false;
      }
    } else if (event.button === 2) {
      physicalRmb = false;
    }
  }, true);
  window.addEventListener('blur', resetRuntime);

  installShotTickFix();
  announce();
  timer = setInterval(announce, RETRY_INTERVAL_MS);
  setInterval(installHooks, 250);
  setInterval(installWorldPatch, 500);
  setInterval(installEngineSnapshotHook, 500);
  setInterval(sendInputState, 33);

  setInterval(() => {
    if (!active || uiOpen || window.GH?.G?.state !== 'playing') {
      clearAutoFireRequests();
      runHooks(resetHooks);
    }
  }, 500);
})();
