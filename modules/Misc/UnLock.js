(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-misc';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;

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
    desc: 'Unlocks all weapons and camos.',
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
})();
