(() => {
  'use strict';

  const CHANNEL = 'solstice-player';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
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

  function syncConfig() {
    const module = getMod('GodMode');

    if (!module) {
      return;
    }

    const onlyLethal = Boolean(module.settings.find((s) => s.n === 'Only Lethal')?.v ?? 1);
    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'godmode',
      enabled: Boolean(module.on),
      onlyLethal
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

  register({
    game: 'potatoepic',
    name: 'GodMode',
    desc: 'Keeps the local player at full health.',
    cat: 'Player',
    nm: { l: 'godmode', ls: 'god mode', n: 'GodMode', ns: 'God Mode' },
    disp: '',
    settings: [
      { t: 'b', n: 'Only Lethal', d: 'Only block hits that would kill you on the next shot.', v: 1 }
    ],
    onRender: syncConfig,
    onEnable() {
      lastSentAt = 0;
      lastSentKey = '';
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
    let enabled = false;
    let onlyLethal = true;
    let hook = null;

    function maxHealth(player) {
      const value = Number(player?.maxHealth ?? player?.maxHp ?? player?.maxHealthValue ?? 20);
      return Math.max(1, Number.isFinite(value) ? value : 20);
    }

    function active(game, player) {
      return Boolean(
        enabled &&
        game &&
        game.player === player &&
        game.state === 'play' &&
        player &&
        !player.dead &&
        !(Number(player.deathTime) > 0)
      );
    }

    function protectHealth(game, player) {
      const own = Object.getOwnPropertyDescriptor(player, 'health');

      if ((own && !own.configurable) || (!own && !Object.isExtensible(player))) {
        return null;
      }

      let source = own;
      let proto = player;

      while (!source && (proto = Object.getPrototypeOf(proto))) {
        source = Object.getOwnPropertyDescriptor(proto, 'health');
      }

      if (!source) {
        return null;
      }

      const data = Object.hasOwn(source, 'value');

      if (
        (data && (!own || !source.writable || !Number.isFinite(source.value))) ||
        (!data && (typeof source.get !== 'function' || typeof source.set !== 'function'))
      ) {
        return null;
      }

      let value = source.value;
      const get = function godModeHealthGet() {
        return data ? value : Reflect.apply(source.get, this, []);
      };
      const set = function godModeHealthSet(next) {
        if (this !== player) {
          if (!data) {
            return Reflect.apply(source.set, this, [next]);
          }

          Object.defineProperty(this, 'health', {
            value: next,
            writable: true,
            configurable: true,
            enumerable: true
          });
          return;
        }

        const current = get.call(player);

        if (
          typeof next === 'number' &&
          Number.isFinite(current) &&
          next < current &&
          active(game, player) &&
          (!onlyLethal || next <= 0)
        ) {
          return;
        }

        if (data) {
          value = next;
        } else {
          Reflect.apply(source.set, player, [next]);
        }
      };

      Object.defineProperty(player, 'health', {
        get,
        set,
        configurable: true,
        enumerable: source.enumerable
      });

      return () => {
        const descriptor = Object.getOwnPropertyDescriptor(player, 'health');

        if (descriptor?.get !== get || descriptor?.set !== set) {
          return;
        }

        if (!own) {
          delete player.health;
        } else {
          Object.defineProperty(player, 'health', data ? { ...own, value } : own);
        }
      };
    }

    function protectDamage(game, player, key) {
      const original = player[key];
      const before = Object.getOwnPropertyDescriptor(player, key);

      if (
        typeof original !== 'function' ||
        (before && (!Object.hasOwn(before, 'value') || !before.writable)) ||
        (!before && !Object.isExtensible(player))
      ) {
        return null;
      }

      const wrapper = function godModeDamage(...args) {
        const first = args[0];
        const amount = typeof first === 'number' ? first : first?.amount ?? first?.damage ?? args[1];

        if (this === player && typeof amount === 'number' && amount > 0 && active(game, player)) {
          if (!onlyLethal) {
            return false;
          }
          const curHp = Number(player.health);
          if (Number.isFinite(curHp) && curHp - amount <= 0) {
            return false;
          }
        }

        return Reflect.apply(original, this, args);
      };

      Object.defineProperty(player, key, before
        ? { ...before, value: wrapper }
        : { value: wrapper, writable: true, configurable: true });

      return () => {
        if (player[key] !== wrapper) {
          return;
        }

        if (before) {
          Object.defineProperty(player, key, before);
        } else {
          delete player[key];
        }
      };
    }

    function reconcile(game) {
      const player = game?.player;
      const shouldProtect = Boolean(
        enabled &&
        game?.state === 'play' &&
        player &&
        !player.dead &&
        !(Number(player.deathTime) > 0) &&
        Number.isFinite(player.health)
      );

      if (hook) {
        if (shouldProtect && hook.game === game && hook.player === player) {
          return;
        }

        const old = hook;
        hook = null;

        for (const undo of old.cleanup.reverse()) {
          try {
            undo();
          } catch {

          }
        }
      }

      if (!shouldProtect) {
        return;
      }

      const cleanup = [];

      try {
        const undo = protectHealth(game, player);

        if (undo) {
          cleanup.push(undo);
        }
      } catch {

      }

      for (const name of ['hurt', 'takeDamage']) {
        try {
          const undo = protectDamage(game, player, name);

          if (undo) {
            cleanup.push(undo);
          }
        } catch {

        }
      }

      if (cleanup.length) {
        hook = { game, player, cleanup };
      }

      try {
        if (!onlyLethal) {
          const full = maxHealth(player);

          if (player.health < full) {
            player.health = full;
          }
        }
      } catch {

      }
    }


    bridge.onConfig(CHANNEL, (data) => {
      if (data.type !== 'config' || data.module !== 'godmode') {
        return;
      }

      enabled = Boolean(data.enabled);
      onlyLethal = data.onlyLethal !== false;
      reconcile(window.game);
    });

    setInterval(() => {
      reconcile(window.game);
    }, 500);
  }
})();
