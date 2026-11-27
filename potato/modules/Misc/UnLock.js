(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && (location.pathname.startsWith('/toy/golden-hour/') || location.pathname.startsWith('/toy/potatoepic/'))) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-misc';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const gamePrefix = () => (document.documentElement?.getAttribute('data-solstice-game') === 'potatoepic' || location.pathname.includes('/potatoepic/')) ? '/toy/potatoepic/' : '/toy/golden-hour/';
  const HEARTBEAT_MS = 500;

  let lastSentKey = '';
  let lastSentAt = 0;

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}${gamePrefix()}`)) {
        return frame;
      }
    }

    return null;
  }

  function syncConfig() {
    const module = getMod('UnLock');

    if (!module) {
      return;
    }

    const now = performance.now();
    const config = {
      channel: CHANNEL,
      type: 'config',
      module: 'unlock',
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

  register({
    name: 'UnLock',
    desc: 'Unlocks gated weapons and cosmetics.',
    cat: 'Misc',
    nm: { l: 'unlock', ls: 'un lock', n: 'UnLock', ns: 'Un Lock' },
    disp: '',
    settings: [],
    onRender: syncConfig,
    onEnable() {}
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
    if (bridge.game === 'potatoepic') {
      installPotatoUnlock(bridge);
      return;
    }

    let enabled = false;
    let timer = 0;
    let originalCanUse = null;
    let originalProfile = null;
    let originalWriteProfile = null;
    const names = ['ar', 'smg', 'shotgun', 'pistol', 'm200'];

    function game() {
      return window.GH?.debug?.ctx;
    }

    function profileApi() {
      return window.GHProgress;
    }

    function mergeProgress(next) {
      const current = profileApi()?.readProfile?.();

      if (!current?.weapons || !next?.weapons) {
        return next;
      }

      let total = 0;

      for (const name of names) {
        const existing = current.weapons[name];
        const weapon = next.weapons[name] || (next.weapons[name] = { kills: 0, headshots: 0 });

        weapon.kills = Math.max(Number(weapon.kills) || 0, Number(existing?.kills) || 0);
        weapon.headshots = Math.max(Number(weapon.headshots) || 0, Number(existing?.headshots) || 0);
        total += weapon.kills;
      }

      next.kills = Math.max(total, Number(next.kills) || 0, Number(current.kills) || 0);
      next.matches = Math.max(0, Number(next.matches) || 0, Number(current.matches) || 0);
      next.wins = Math.max(0, Number(next.wins) || 0, Number(current.wins) || 0);
      next.xp = Math.max(0, Number(next.xp) || 0, Number(current.xp) || 0);
      return next;
    }

    function installProfileGuard() {
      if (originalWriteProfile) {
        return;
      }

      const api = profileApi();

      if (typeof api?.writeProfile !== 'function') {
        return;
      }

      originalWriteProfile = api.writeProfile;
      api.writeProfile = function guardedWriteProfile(profile) {
        return originalWriteProfile.call(this, mergeProgress(profile));
      };
    }

    function removeProfileGuard() {
      const api = profileApi();

      if (originalWriteProfile && api?.writeProfile) {
        api.writeProfile = originalWriteProfile;
      }

      originalWriteProfile = null;
    }

    function allProfile(profile) {
      const weapons = profile?.weapons;

      if (!weapons) {
        return null;
      }

      const names = ['ar', 'smg', 'shotgun', 'pistol', 'm200'];
      let total = 0;
      let changed = false;

      for (const name of names) {
        const weapon = weapons[name] || (weapons[name] = { kills: 0, headshots: 0 });
        const kills = Math.max(300, Number(weapon.kills) || 0);
        const headshots = Math.max(300, Number(weapon.headshots) || 0);

        if (weapon.kills !== kills || weapon.headshots !== headshots) {
          weapon.kills = kills;
          weapon.headshots = headshots;
          changed = true;
        }

        total += kills;
      }

      if (profile.kills !== total) {
        profile.kills = total;
        changed = true;
      }

      if ((profile.matches || 0) < 1) {
        profile.matches = 1;
        changed = true;
      }

      if ((profile.wins || 0) < 1) {
        profile.wins = 1;
        changed = true;
      }

      return changed ? profile : null;
    }

    function refreshMenus() {
      const menus = game()?.hud?.menus;

      if (!menus) {
        return;
      }

      if (menus.page === 'gunsmith' && typeof menus._gsRender === 'function') {
        menus._gsRender(false);
      }

      if (menus.page === 'main' && typeof menus._refreshMain === 'function') {
        menus._refreshMain();
      }
    }

    function applyProfile() {
      installProfileGuard();

      const api = profileApi();
      const profile = api?.readProfile?.();

      if (!profile) {
        return;
      }

      if (!originalProfile) {
        originalProfile = JSON.parse(JSON.stringify(profile));
      }

      const next = allProfile(profile);

      if (!next) {
        return;
      }

      api.writeProfile(next);

      try {
        api.persist?.(api.profileKey, next);
      } catch {

      }

      refreshMenus();
    }

    function restoreProfile() {
      if (!originalProfile) {
        return;
      }

      const api = profileApi();
      const profile = originalProfile;
      originalProfile = null;

      if (!api?.writeProfile) {
        return;
      }

      api.writeProfile(profile);

      try {
        api.persist?.(api.profileKey, profile);
      } catch {

      }

      refreshMenus();
    }

    function unlockWeapons() {
      const url = new URL('client/toy-weapons.js', location.href).href;

      import(url).then(({ ToyWeaponAccess }) => {
        if (!enabled || !ToyWeaponAccess?.prototype) {
          return;
        }

        const prototype = ToyWeaponAccess.prototype;

        if (!originalCanUse) {
          originalCanUse = prototype.canUse;
        }

        prototype.canUse = function canUseAll() {
          return true;
        };

        refreshMenus();
      }).catch(() => {

      });
    }

    function relockWeapons() {
      if (!originalCanUse) {
        return;
      }

      const url = new URL('client/toy-weapons.js', location.href).href;

      import(url).then(({ ToyWeaponAccess }) => {
        if (enabled || !ToyWeaponAccess?.prototype) {
          return;
        }

        ToyWeaponAccess.prototype.canUse = originalCanUse;
        originalCanUse = null;
        refreshMenus();
      }).catch(() => {

      });
    }

    function startTimer() {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        if (enabled) {
          applyProfile();
          refreshMenus();
        }
      }, 1000);
    }

    function stopTimer() {
      if (timer) {
        clearInterval(timer);
        timer = 0;
      }
    }

    function setEnabled(next) {
      if (enabled === next) {
        return;
      }

      enabled = next;

      if (enabled) {
        installProfileGuard();
        unlockWeapons();
        applyProfile();
        startTimer();
      } else {
        stopTimer();
        removeProfileGuard();
        relockWeapons();
        restoreProfile();
      }
    }

    bridge.onConfig('solstice-misc', (data) => {
      if (data.type === 'config' && data.module === 'unlock') {
        setEnabled(Boolean(data.enabled));
      }
    });
  }

  function installPotatoUnlock(bridge) {
    let enabled = false;
    let timer = 0;
    let originalHas = null;
    let originalCheckUnlocks = null;
    let originalAllUnlocked = null;
    let previousUnlocks = null;
    let previousOwned = null;
    let previousSuper;
    let skinObject = null;
    let originalSkinOwns = null;
    let originalViewDescriptor = null;
    let unlockedToken = '';
    let lastAttempt = 0;

    function account() {
      try {
        return typeof Account !== 'undefined' ? Account : null;
      } catch {
        return null;
      }
    }

    function localUnlock() {
      const acc = account();

      if (!acc?.data) {
        return;
      }

      const rules = self.PotatoSkinRules;
      const owned = new Set(Array.isArray(acc.data.owned) ? acc.data.owned : []);

      try {
        for (const item of (typeof Cosmetics !== 'undefined' ? Cosmetics.LIST : [])) {
          if (item?.id) {
            owned.add(item.id);
          }
        }
      } catch {

      }

      try {
        for (const cape of (typeof Capes !== 'undefined' ? Capes.list : [])) {
          if (cape?.id) {
            owned.add('cape:' + cape.id);
          }
        }
      } catch {

      }

      if (rules) {
        for (const id of rules.IDS || []) owned.add(id);
        for (const id of rules.XZP_IDS || []) owned.add(id);

        for (const gun of rules.BLOSSOM_GUNS || []) {
          owned.add('blossom:' + gun);
        }

        for (const reward of rules.BEV_RW || []) {
          if (reward?.id) {
            owned.add(reward.id);
          }
        }
      }

      acc.data.owned = [...owned];
      acc.data.super = true;
      acc.data.unlocks = {
        ...(acc.data.unlocks || {}),
        follow: true,
        triple: true,
        online: true,
        static: true,
        anim: true,
        jing: true,
        ai: true
      };
      acc.gate = { requireAccount: false, follow: false, triple: false };
      acc.save?.();
    }

    function unlockSkinView(skins) {
      if (!skins || skins.__solsticeUnlockView || skinObject === skins) {
        return;
      }

      const rules = self.PotatoSkinRules;

      if (!rules) {
        return;
      }

      skinObject = skins;
      originalSkinOwns = skins.owns;
      originalViewDescriptor = Object.getOwnPropertyDescriptor(skins, 'v');

      const owns = function ownsUnlocked(id) {
        if (enabled) {
          return true;
        }

        return originalSkinOwns.call(this, id);
      };

      Object.defineProperty(owns, '__solsticeUnlockView', { value: true });
      skins.owns = owns;

      const originalGet = originalViewDescriptor?.get;

      try {
      Object.defineProperty(skins, 'v', {
        configurable: true,
        get() {
          const base = originalGet ? originalGet.call(this) : {};

          if (!enabled) {
            return base;
          }

          const allOwn = [...new Set([
            ...(rules.IDS || []),
            ...(rules.XZP_IDS || []),
            ...(rules.BLOSSOM_GUNS || []).map((gun) => 'blossom:' + gun),
            ...(rules.BEV_RW || []).map((reward) => reward.id)
          ])];
          const knives = [...new Set([...(rules.KNIVES || []), ...(rules.BEV_RW || [])
            .map((reward) => reward.id)
            .filter((id) => String(id).startsWith('knife_'))])];
          const paints = rules.PAINTS || [];
          const kp = Object.fromEntries(knives.map((knife) => [knife, paints.slice()]));
          const rewards = (rules.BEV_RW || []).map((reward) => ({
            id: reward.id,
            k: reward.k,
            n: reward.n,
            have: reward.n,
            got: true,
            done: true,
            can: false
          }));

          return {
            ...base,
            own: [...new Set([...(base.own || []), ...allOwn])],
            knives: [...new Set([...(base.knives || []), ...knives])],
            kp: { ...(base.kp || {}), ...kp },
            sets: [...new Set([...(base.sets || []), ...Object.keys(rules.SETS || {})])],
            ev: base.ev
              ? { ...base.ev, un: true, rw: rewards, can: 0 }
              : base.ev
          };
        }
      });
      } catch {

      }

      try {
        Object.defineProperty(skins, '__solsticeUnlockView', { value: true });
      } catch {

      }
    }

    function installPatches() {
      const acc = account();

      if (!acc) {
        return;
      }

      localUnlock();
      unlockSkinView(window.XZ?.skins);

      if (typeof acc.has === 'function' && !acc.has.__solsticePotatoUnlock) {
        originalHas = acc.has;
        const wrappedHas = function wrappedPotatoUnlockHas(name) {
          if (!enabled) {
            return originalHas.call(this, name);
          }

          return true;
        };

        Object.defineProperty(wrappedHas, '__solsticePotatoUnlock', { value: true });
        acc.has = wrappedHas;
      }

      if (typeof acc.checkUnlocks === 'function' && !acc.checkUnlocks.__solsticePotatoUnlock) {
        originalCheckUnlocks = acc.checkUnlocks;
        const wrappedCheckUnlocks = async function wrappedPotatoUnlockCheck(...args) {
          if (!enabled) {
            return originalCheckUnlocks.apply(this, args);
          }

          localUnlock();
          return { inToy: false, forced: true };
        };

        Object.defineProperty(wrappedCheckUnlocks, '__solsticePotatoUnlock', { value: true });
        acc.checkUnlocks = wrappedCheckUnlocks;
      }

      if (typeof acc.allUnlocked === 'function' && !acc.allUnlocked.__solsticePotatoUnlock) {
        originalAllUnlocked = acc.allUnlocked;
        const wrappedAllUnlocked = function wrappedPotatoUnlockAll() {
          return enabled ? true : originalAllUnlocked.call(this);
        };

        Object.defineProperty(wrappedAllUnlocked, '__solsticePotatoUnlock', { value: true });
        acc.allUnlocked = wrappedAllUnlocked;
      }

      try {
        if (typeof Toy !== 'undefined') {
          if (typeof Toy.following === 'function' && !Toy.following.__solsticePotatoUnlock) {
            const origFollowing = Toy.following;
            const wrappedFollowing = async function wrappedPotatoFollowing(...args) {
              if (enabled) {
                if (Toy.last && typeof Toy.last === 'object') {
                  Toy.last.relation = {
                    status: 'ok',
                    data: { isFollowing: true, isAuthor: false, isOldFan: false, hasFanMedal: false, isCharging: false }
                  };
                }
                return true;
              }
              return origFollowing.apply(this, args);
            };
            Object.defineProperty(wrappedFollowing, '__solsticePotatoUnlock', { value: true });
            Toy.following = wrappedFollowing;
          }
          if (typeof Toy.triple === 'function' && !Toy.triple.__solsticePotatoUnlock) {
            const origTriple = Toy.triple;
            const wrappedTriple = async function wrappedPotatoTriple(...args) {
              if (enabled) {
                return { all: true, like: true, coin: true, fav: true };
              }
              return origTriple.apply(this, args);
            };
            Object.defineProperty(wrappedTriple, '__solsticePotatoUnlock', { value: true });
            Toy.triple = wrappedTriple;
          }
        }
      } catch {}
    }

    function restorePatches() {
      const acc = account();

      if (!acc) {
        return;
      }

      if (originalHas && acc.has?.__solsticePotatoUnlock) {
        acc.has = originalHas;
      }

      if (originalCheckUnlocks && acc.checkUnlocks?.__solsticePotatoUnlock) {
        acc.checkUnlocks = originalCheckUnlocks;
      }

      if (originalAllUnlocked && acc.allUnlocked?.__solsticePotatoUnlock) {
        acc.allUnlocked = originalAllUnlocked;
      }

      if (previousUnlocks && acc.data) {
        acc.data.unlocks = previousUnlocks;
      }

      if (acc.data) {
        if (previousOwned === null) {
          delete acc.data.owned;
        } else {
          acc.data.owned = previousOwned;
        }

        if (previousSuper === undefined) {
          delete acc.data.super;
        } else {
          acc.data.super = previousSuper;
        }

        acc.save?.();
      }

      if (skinObject && originalSkinOwns) {
        skinObject.owns = originalSkinOwns;
      }

      if (skinObject && originalViewDescriptor) {
        Object.defineProperty(skinObject, 'v', originalViewDescriptor);
      }

      if (skinObject) {
        try {
          delete skinObject.__solsticeUnlockView;
        } catch {

        }
      }

      skinObject = null;
      originalSkinOwns = null;
      originalViewDescriptor = null;
      previousOwned = null;
      previousSuper = undefined;

      originalHas = null;
      originalCheckUnlocks = null;
      originalAllUnlocked = null;
      previousUnlocks = null;
      unlockedToken = '';
      lastAttempt = 0;
    }

    async function unlockServer() {
      const acc = account();

      if (!enabled || !acc?.token) {
        return;
      }

      if (acc.token === unlockedToken && acc.data?.unlocks?.triple) {
        return;
      }

      const now = Date.now();

      if (now - lastAttempt < 5000) {
        return;
      }

      lastAttempt = now;

      let gate = {};

      try {
        gate = await acc.api('/api/gate');
      } catch {

      }

      const videos = Array.isArray(gate?.videos) ? gate.videos : [];

      try {
        const result = await acc.api('/api/account/unlocks', {
          follow: true,
          triple: true,
          ai: true,
          videos,
          tv: videos[0] || null,
          any: true
        });

        if (result?.account) {
          acc.took?.(result);
        } else {
          localUnlock();
        }

        unlockedToken = acc.token;
      } catch {

      }
    }

    function startTimer() {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        if (!enabled) {
          return;
        }

        installPatches();
        unlockServer();
      }, 1000);
    }

    function stopTimer() {
      if (timer) {
        clearInterval(timer);
        timer = 0;
      }
    }

    function setEnabled(next) {
      if (enabled === next) {
        return;
      }

      if (next) {
        const acc = account();
        previousUnlocks = acc?.data ? { ...(acc.data.unlocks || {}) } : null;
        previousOwned = acc?.data && Array.isArray(acc.data.owned) ? acc.data.owned.slice() : null;
        previousSuper = acc?.data ? acc.data.super : undefined;
        enabled = true;
        installPatches();
        unlockServer();
        startTimer();
      } else {
        enabled = false;
        stopTimer();
        restorePatches();
      }
    }

    bridge.onConfig('solstice-misc', (data) => {
      if (data.type === 'config' && data.module === 'unlock') {
        setEnabled(Boolean(data.enabled));
      }
    });
  }
})();
