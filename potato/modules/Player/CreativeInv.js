(() => {
  'use strict';

  const CHANNEL = 'solstice-player';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const PARENT_ORIGIN = 'https://www.bilibili.com';
  const HEARTBEAT_MS = 500;

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

  function syncConfig(force = false) {
    const module = getMod('CreativeInv');

    if (!module) {
      return;
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'creativeinv',
      enabled: Boolean(module.on)
    };
    const key = JSON.stringify(config);

    if (!force && key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) {
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

  register({
    game: 'potatoepic',
    name: 'CreativeInv',
    desc: 'Opens the creative inventory once, then turns itself off.',
    cat: 'Player',
    nm: { l: 'creativeinv', ls: 'creative inv', n: 'CreativeInv', ns: 'Creative Inv' },
    disp: '',
    settings: [],
    onRender: () => syncConfig(),
    onEnable() {
      lastSentKey = '';
      lastSentAt = 0;
      syncConfig(true);
    }
  });

  setInterval(() => syncConfig(), 250);

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN) {
      return;
    }

    const data = event.data;

    if (
      !data ||
      data.channel !== CHANNEL ||
      (data.type !== 'opened' && data.type !== 'closed') ||
      data.module !== 'creativeinv'
    ) {
      return;
    }

    const frame = findGameFrame();

    if (frame && event.source !== frame.contentWindow) {
      return;
    }

    const module = getMod('CreativeInv');

    if (module && typeof setModuleOn === 'function') {
      setModuleOn(module, false);
      syncConfig(true);
    }
  });

  function bootGame() {
    let attempts = 0;

    function start() {
      const bridge = window.SolsticeGame;

      if (!bridge) {
        if (attempts++ < 200) {
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
    let opening = false;
    let done = false;
    let autoOpened = false;
    let retryTimer = 0;
    let dropHookedGame = null;
    let renderHookedGame = null;
    let xzeCreativeInstalled = false;
    let xzeCreativeKeys = [];
    let xzeIconIds = new Set();
    let xzeIconHooked = false;
    const xzeIconCache = new Map();

    function game() {
      try {
        return window.game || null;
      } catch {
        return null;
      }
    }

    function creativeClass() {
      try {
        return typeof CreativeScreen === 'function' ? CreativeScreen : null;
      } catch {
        return null;
      }
    }

    function isCreative(screen) {
      const C = creativeClass();

      try {
        if (C && screen instanceof C) {
          return true;
        }
      } catch {

      }

      try {
        return Boolean(screen && screen.constructor && screen.constructor.name === 'CreativeScreen');
      } catch {
        return false;
      }
    }

    function stopRetry() {
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = 0;
      }
    }

    function finish() {
      if (!enabled || done) {
        return;
      }

      done = true;
      autoOpened = true;
      stopRetry();

      try {
        window.parent.postMessage({
          channel: CHANNEL,
          type: 'opened',
          module: 'creativeinv'
        }, PARENT_ORIGIN);
      } catch {

      }
    }

    function installXzeIcons() {
      if (
        xzeIconHooked ||
        typeof UI === 'undefined' ||
        !UI.prototype ||
        typeof UI.prototype.itemIcon !== 'function'
      ) {
        return;
      }

      const original = UI.prototype.itemIcon;

      UI.prototype.itemIcon = function creativeInvItemIcon(id) {
        if (!xzeIconIds.has(id)) {
          return original.call(this, id);
        }

        const item = typeof ITEMS !== 'undefined' ? ITEMS[id] : null;
        let key = item && item.key;

        if (!key) {
          return original.call(this, id);
        }

        if (key.startsWith('xzext:')) {
          key = key.slice(7);
        }

        let url = '';

        try {
          url = window.XZE && typeof window.XZE.iconUrl === 'function'
            ? window.XZE.iconUrl(key)
            : '';
        } catch {
          url = '';
        }

        if (!url) {
          return original.call(this, id);
        }

        let image = xzeIconCache.get(url);

        if (!image) {
          image = new Image();
          image.src = url;
          xzeIconCache.set(url, image);
        }

        if (!image.complete || !image.naturalWidth) {
          return original.call(this, id);
        }

        return image;
      };

      xzeIconHooked = true;
    }

    function installXzeCreative() {
      if (xzeCreativeInstalled) {
        return;
      }

      if (
        typeof ITEM_KEY === 'undefined' ||
        typeof ITEMS === 'undefined' ||
        typeof CREATIVE_TABS === 'undefined'
      ) {
        return;
      }

      const list = window.XZE_ITEMS;

      if (!Array.isArray(list) || !list.length) {
        return;
      }

      const texOf = (key) => {
        const id = ITEM_KEY[key];
        const item = id === undefined ? null : ITEMS[id];
        return item && item.tex;
      };

      const fallbackByCat = {
        valuable: 'gold_ingot',
        intel: 'paper',
        elec: 'redstone',
        medv: 'apple',
        heal: 'apple',
        tool: 'iron_ingot',
        throw: 'snowball',
        ammo: 'arrow',
        armor: 'iron_chestplate',
        helmet: 'iron_helmet',
        bag: 'leather',
        key: 'tripwire_hook'
      };

      const keys = [];

      for (const source of list) {
        const original = source && source.id;

        if (!original) {
          continue;
        }

        let key = original;

        if (ITEM_KEY[key] !== undefined) {
          key = 'xzext:' + original;
        }

        if (ITEM_KEY[key] !== undefined) {
          continue;
        }

        const stackDefault = ['armor', 'helmet', 'bag'].includes(source.cat) ? 1 : 64;
        const stack = Math.max(1, Math.min(64, Number(source.stack) || stackDefault));
        const fallback = fallbackByCat[source.cat] || 'paper';
        const tex = texOf(fallback) || texOf('paper');
        const options = { stack, tex };

        if (source.dur) {
          options.durability = Math.max(1, Number(source.dur) || 1);
        }

        let def = null;

        try {
          if (typeof defItem === 'function') {
            def = defItem(key, source.cn || original, options);
          }
        } catch {

        }

        if (!def && typeof ITEMS !== 'undefined' && ITEM_KEY) {
          let id = 1;

          for (let index = 0; index < ITEMS.length; index++) {
            if (ITEMS[index]) {
              id = index + 1;
            }
          }

          def = {
            id,
            key,
            cn: source.cn || original,
            stack: options.stack,
            tex: options.tex
          };

          ITEMS[id] = def;
          ITEM_KEY[key] = id;
        }

        if (!def) {
          continue;
        }

        def.tab = 'xzext';
        xzeIconIds.add(def.id);
        keys.push(key);
      }

      if (!keys.length) {
        return;
      }

      xzeCreativeKeys = keys;

      if (!CREATIVE_TABS.some((tab) => tab && tab.id === 'xzext')) {
        CREATIVE_TABS.push({
          id: 'xzext',
          name: '搜打撤',
          icon: 'chest',
          get items() {
            return xzeCreativeKeys.slice();
          }
        });
      }

      xzeCreativeInstalled = true;
    }

    function inRaid(g) {
      const xze = window.XZE;

      if (!xze) {
        return false;
      }

      try {
        if (typeof xze.inRaid === 'function') {
          return Boolean(xze.inRaid(g));
        }
      } catch {

      }

      return Boolean(xze.R && xze.R.st === 'play');
    }

    function toXzeItems(stack) {
      const xze = window.XZE;
      const items = typeof ITEMS !== 'undefined' ? ITEMS : null;
      const entry = items && stack ? items[stack.id] : null;
      let key = entry && entry.key;

      if (key && key.startsWith('xzext:')) {
        key = key.slice(7);
      }

      if (!xze || !key || typeof xze.def !== 'function' || typeof xze.make !== 'function') {
        return null;
      }

      const def = xze.def(key);

      if (!def) {
        return null;
      }

      let remaining = Math.max(1, Math.floor(Number(stack.count) || 1));
      const out = [];
      const stackMax = Math.max(1, Number(def.stack) || 1);

      while (remaining > 0) {
        const count = Math.min(stackMax, remaining);
        const made = xze.make(key, { n: count });

        if (!made) {
          return null;
        }

        if (stack.dmg && def.dur) {
          made.d = Math.max(0, Number(stack.dmg) || 0);
        }

        out.push(made);
        remaining -= count;
      }

      return out.length ? out : null;
    }

    function ensureDropState() {
      const xze = window.XZE;
      const R = xze && xze.R;

      if (!R || typeof R !== 'object') {
        return false;
      }

      if (!Array.isArray(R.dyn)) {
        R.dyn = [];
      }

      if (!R.P || !R.P.cell || typeof R.P.cell.has !== 'function') {
        R.P = { cell: new Map() };
      }

      if (R.net === undefined) {
        R.net = null;
      }

      if (!xze.__solsticeCreativeDefs && typeof xze.def === 'function') {
        const nativeDef = xze.def;
        const gameItems = typeof ITEMS !== 'undefined' ? ITEMS : [];
        const byKey = new Map();

        for (const item of gameItems) {
          if (item && item.key && !byKey.has(item.key)) {
            byKey.set(item.key, item);
          }
        }

        const wrappedDef = function creativeInvDef(key) {
          const found = nativeDef.apply(this, arguments);

          if (found) {
            return found;
          }

          let lookup = key;

          if (typeof lookup === 'string' && lookup.startsWith('xzext:')) {
            lookup = lookup.slice(7);
          }

          const item = lookup && byKey.get(lookup);

          if (!item) {
            return null;
          }

          let max = 64;

          try {
            if (typeof maxStack === 'function') {
              max = Math.max(1, Number(maxStack(item.id)) || 64);
            }
          } catch {

          }

          return {
            id: key,
            cn: item.cn || key,
            cat: 'misc',
            w: 1,
            h: 1,
            stack: max,
            r: 0,
            price: 0
          };
        };

        try {
          xze.def = wrappedDef;
          xze.__solsticeCreativeDefs = true;
        } catch {

        }
      }

      return true;
    }

    function hasCreativeDrops() {
      const R = window.XZE && window.XZE.R;

      return Boolean(
        R &&
        Array.isArray(R.dyn) &&
        R.dyn.some((box) => box && box.__solsticeCreativeDrop && box.g && box.g.items && box.g.items.length)
      );
    }

    function hookRender(g) {
      if (!g || renderHookedGame === g || typeof g.render !== 'function') {
        return;
      }

      const xze = window.XZE;

      if (!xze || typeof xze.inRaid !== 'function') {
        return;
      }

      const originalRender = g.render;

      g.render = function creativeInvRender(...args) {
        if (!hasCreativeDrops()) {
          return originalRender.apply(this, args);
        }

        const originalInRaid = xze.inRaid;

        try {
          xze.inRaid = function creativeInvInRaid(target) {
            if (target === g && hasCreativeDrops()) {
              return true;
            }

            return originalInRaid.apply(this, arguments);
          };
        } catch {
          return originalRender.apply(this, args);
        }

        try {
          return originalRender.apply(this, args);
        } finally {
          try {
            xze.inRaid = originalInRaid;
          } catch {

          }
        }
      };

      renderHookedGame = g;
    }

    function hookDrop(g) {
      if (!g || dropHookedGame === g || typeof g.dropFromPlayer !== 'function') {
        return;
      }

      const originalDrop = g.dropFromPlayer;

      g.dropFromPlayer = function creativeInvDrop(stack, ...args) {
        if (isCreative(g.ui && g.ui.screen) && inRaid(g) && ensureDropState()) {
          const items = toXzeItems(stack);

          if (items && items.length) {
            try {
              const box = window.XZE.dropItems(g, g.player.pos, items);

              if (box) {
                box.__solsticeCreativeDrop = true;
                return;
              }
            } catch {

            }
          }
        }

        return originalDrop.apply(this, [stack, ...args]);
      };

      dropHookedGame = g;
    }

    function openDirect(g, screen) {
      const ui = g.ui;
      const old = ui.screen;

      if (old && old !== screen && typeof old.close === 'function') {
        try {
          old.close();
        } catch {

        }
      }

      ui.screen = screen;

      try {
        ui.hideInput();
      } catch {

      }

      try {
        screen.layout();
      } catch {

      }

      try {
        const raw = g.rawMouse &&
          (g.rawMouse[0] || g.rawMouse[1] || g.rawMouse[2]) &&
          document.pointerLockElement === g.canvas;

        if (!screen.keepPointer) {
          if (raw) {
            g.unlockOnUp = true;
          } else if (typeof g.releasePointer === 'function') {
            g.releasePointer();
          }
        }
      } catch {

      }
    }

    function tick() {
      if (!enabled || done || opening) {
        return;
      }

      const g = game();
      const C = creativeClass();

      if (!g || !C || g.state !== 'play' || !g.player || !g.ui) {
        return;
      }

      installXzeCreative();
      installXzeIcons();
      hookDrop(g);
      hookRender(g);
      opening = true;

      try {
        if (isCreative(g.ui.screen)) {
          finish();
          return;
        }

        openDirect(g, new C(g));
      } catch {

      } finally {
        opening = false;
      }

      finish();
    }

    function setEnabled(next) {
      const wasEnabled = enabled;
      enabled = Boolean(next);

      if (!enabled) {
        stopRetry();
        opening = false;

        if (autoOpened) {
          return;
        }

        done = false;

        const g = game();

        if (g?.ui && isCreative(g.ui.screen)) {
          try {
            g.ui.close();
          } catch {

          }
        }

        return;
      }

      if (wasEnabled) {
        return;
      }

      done = false;
      autoOpened = false;
      tick();

      if (!done && !retryTimer) {
        retryTimer = setInterval(tick, 250);
      }
    }

    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'creativeinv') {
        return;
      }

      setEnabled(data.enabled);
    });

    setInterval(() => {
      const g = game();

      if (g) {
        installXzeCreative();
        installXzeIcons();
        hookDrop(g);
        hookRender(g);
      }
    }, 500);
  }
})();
