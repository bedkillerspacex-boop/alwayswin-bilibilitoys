(() => {
  'use strict';

  /* ════════════════════════════════════════════════════════════════════
     Solstice config engine

     • 每次启动第一件事：从 localStorage 恢复上次激活的配置（同步执行）
     • 首次启动：自动建立 Default 配置，并把 Default.cfg 镜像到
       Downloads/Solstice/（下载 API 会自动创建该文件夹）
     • 配置内容：模块开关 / 全部设置 / 按键绑定 / HUD 元素位置
     • 磁盘镜像走扩展后台（chrome.downloads，overwrite 覆盖同一个文件）
     • 支持导入 .cfg、导出 .cfg、打开配置文件夹
     ════════════════════════════════════════════════════════════════════ */

  const VERSION = 2;
  const STORE_KEY = 'solstice.configs.v2';
  const ACTIVE_KEY = 'solstice.config.active';
  const LEGACY_STORE = 'solstice.configs';
  const LEGACY_DEFAULT = 'solstice.config.default';
  const BIND_KEY = 'solstice.binds';
  const HUD_KEY = 'solstice.hud.layout';

  const DEFAULT_NAME = 'Default';
  const FOLDER = 'AlwaysWin';
  const AUTOSAVE_MS = 1200;
  const MIRROR_MS = 4000;
  const BRIDGE_TIMEOUT = 5000;

  let autoSave = true;
  let saveHud = true;
  let saveBinds = true;
  let mirrorTimer = 0;
  let lastHash = '';
  let bridged = false;
  let lastDiskAt = 0;

  /* ── storage helpers ─────────────────────────────────────────────── */

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) ?? fallback) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function sanitizeName(value) {
    return String(value || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 40);
  }

  function notify(message) {
    try {
      document.dispatchEvent(new CustomEvent('solstice:config-notify', { detail: { message } }));
    } catch {

    }

    try {
      console.log('%c[AlwaysWin]', 'color:#ff5fa2;font-weight:bold', message);
    } catch {

    }
  }

  /* ── store ───────────────────────────────────────────────────────── */

  function store() {
    const data = readJson(STORE_KEY, null);

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data;
    }

    return {};
  }

  let storageSyncTimer = 0;

  function scheduleStorageSync() {
    if (storageSyncTimer) {
      return;
    }

    storageSyncTimer = setTimeout(() => {
      storageSyncTimer = 0;
      bridge('storage-save', { store: store(), active: active() }).catch(() => {});
    }, 150);
  }

  function writeStore(next) {
    const ok = writeJson(STORE_KEY, next);
    scheduleStorageSync();
    return ok;
  }

  function names() {
    return Object.keys(store()).sort((a, b) => a.localeCompare(b));
  }

  function active() {
    const stored = sanitizeName(localStorage.getItem(ACTIVE_KEY) || '');
    const data = store();

    if (stored && data[stored]) {
      return stored;
    }

    if (data[DEFAULT_NAME]) {
      return DEFAULT_NAME;
    }

    const first = names()[0];
    return first || DEFAULT_NAME;
  }

  function setActive(name) {
    const clean = sanitizeName(name);
    if (!clean) return false;

    try {
      localStorage.setItem(ACTIVE_KEY, clean);
      return true;
    } catch {
      return false;
    }
  }

  /* ── capture ─────────────────────────────────────────────────────── */

  function serializeSetting(setting) {
    const value = setting.t === 'c'
      ? (Array.isArray(setting.v) ? setting.v.slice(0, 4) : setting.v)
      : setting.t === 'e'
        ? (setting.vals?.[setting.v] ?? setting.v)
        : setting.v;

    return { name: setting.n, type: setting.t, value };
  }

  function captureModules() {
    return MODS.map((mod) => ({
      name: mod.name,
      enabled: Boolean(mod.on),
      key: mod.key || 0,
      bindMode: mod.bindMode === 'hold' ? 'hold' : 'toggle',
      settings: mod.settings.map(serializeSetting)
    }));
  }

  function captureBinds() {
    const binds = {};

    for (const mod of MODS) {
      if (mod.key || mod.bindMode === 'hold') {
        binds[mod.name] = mod.bindMode === 'hold'
          ? { key: mod.key || 0, mode: 'hold' }
          : mod.key;
      }
    }

    return binds;
  }

  function captureHud() {
    const out = {};

    for (const [name, rect] of Object.entries(HUD_LAYOUT || {})) {
      const x = Number(rect?.x);
      const y = Number(rect?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out[name] = { x, y };
      }
    }

    /* 还没拖过的元素用运行中的实际坐标补上 */
    for (const [name, element] of Object.entries(HUD_ELEMENTS || {})) {
      const x = Number(element?.x);
      const y = Number(element?.y);

      if (!out[name] && Number.isFinite(x) && Number.isFinite(y)) {
        out[name] = { x, y };
      }
    }

    return out;
  }

  function snapshot(name) {
    const data = {
      version: VERSION,
      name: sanitizeName(name) || active(),
      savedAt: Date.now(),
      modules: captureModules()
    };

    if (saveBinds) {
      data.binds = captureBinds();
    }

    if (saveHud) {
      data.hud = captureHud();
    }

    return data;
  }

  /* ── apply ───────────────────────────────────────────────────────── */

  function applySetting(setting, entry) {
    if (!setting || !entry) return;

    if (setting.t === 'e') {
      let index = Number(entry.value);

      if (typeof entry.value === 'string' && Array.isArray(setting.vals)) {
        index = setting.vals.indexOf(entry.value);
      }

      if (Number.isInteger(index) && index >= 0 && index < setting.vals.length) {
        setting.v = index;
      }
    } else if (setting.t === 'b') {
      setting.v = entry.value ? 1 : 0;
      setting.bs = setting.v;
    } else if (setting.t === 'n') {
      const value = Number(entry.value);

      if (Number.isFinite(value)) {
        setting.v = value;
      }
    } else if (setting.t === 'c') {
      if (Array.isArray(entry.value)) {
        setting.v = entry.value.slice(0, 4);
      }
    }
  }

  function moduleByName(name) {
    const lower = String(name || '').toLowerCase();
    return MODS.find((mod) => mod.name.toLowerCase() === lower) ||
      MODS.find((mod) => mod.nm?.n?.toLowerCase() === lower) ||
      null;
  }

  function applyBindsMap(binds) {
    if (!binds || typeof binds !== 'object') return;

    for (const mod of MODS) {
      if (Object.prototype.hasOwnProperty.call(binds, mod.name)) {
        const entry = binds[mod.name];
        if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'mode')) {
          mod.key = entry.key || 0;
          mod.bindMode = entry.mode === 'hold' ? 'hold' : 'toggle';
        } else {
          mod.key = entry || 0;
        }
      }
    }

    writeJson(BIND_KEY, captureBinds());
  }

  function applyHudMap(hud) {
    if (!hud || typeof hud !== 'object') return;

    for (const key of Object.keys(HUD_LAYOUT)) {
      delete HUD_LAYOUT[key];
    }

    for (const [name, rect] of Object.entries(hud)) {
      const x = Number(rect?.x);
      const y = Number(rect?.y);

      if (Number.isFinite(x) && Number.isFinite(y)) {
        HUD_LAYOUT[name] = { x, y };
      }
    }

    for (const [name, element] of Object.entries(HUD_ELEMENTS || {})) {
      const stored = HUD_LAYOUT[name];

      if (stored) {
        element.x = stored.x;
        element.y = stored.y;
      }
    }

    try {
      localStorage.setItem(HUD_KEY, JSON.stringify(HUD_LAYOUT));
    } catch {

    }
  }

  function applySnapshot(config, options = {}) {
    if (!config || !Array.isArray(config.modules)) {
      return false;
    }

    for (const entry of config.modules) {
      const mod = moduleByName(entry?.name);

      if (!mod) continue;

      if (Array.isArray(entry.settings)) {
        for (const stored of entry.settings) {
          applySetting(mod.settings.find((setting) => setting.n === stored?.name), stored);
        }
      }

      if (options.binds === false) {
        /* keep current keybind */
      } else {
        if (entry.key !== undefined) {
          mod.key = entry.key || 0;
        }
        if (entry.bindMode === 'hold' || entry.bindMode === 'toggle') {
          mod.bindMode = entry.bindMode;
        }
      }

      if (mod.name !== 'ClickGui') {
        setModuleOn(mod, Boolean(entry.enabled));
      }
    }

    if (options.binds !== false) {
      if (config.binds && typeof config.binds === 'object') {
        applyBindsMap(config.binds);
      } else {
        writeJson(BIND_KEY, captureBinds());
      }
    }

    if (options.hud !== false && config.hud && typeof config.hud === 'object') {
      applyHudMap(config.hud);
    }

    return true;
  }

  /* ── save / load / delete ────────────────────────────────────────── */

  function save(name, options = {}) {
    const clean = sanitizeName(name) || active() || DEFAULT_NAME;
    const data = store();
    data[clean] = snapshot(clean);
    writeStore(data);
    setActive(clean);

    if (options.mirror !== false) {
      writeFile(clean);
    }

    if (!options.silent) {
      notify(`Saved config ${clean}.`);
    }

    lastHash = hashOf(data[clean]);
    return clean;
  }

  function load(name, options = {}) {
    const clean = sanitizeName(name);
    const data = store();
    const config = data[clean];

    if (!config) {
      notify(`Config ${clean || '?'} does not exist.`);
      return false;
    }

    applySnapshot(config, options);
    setActive(clean);

    if (!options.silent) {
      notify(`Loaded config ${clean}.`);
    }

    return true;
  }

  function remove(name) {
    const clean = sanitizeName(name);
    const data = store();

    if (!data[clean]) {
      notify(`Config ${clean || '?'} does not exist.`);
      return false;
    }

    delete data[clean];
    writeStore(data);

    if (localStorage.getItem(ACTIVE_KEY) === clean) {
      const next = names()[0] || DEFAULT_NAME;
      setActive(next);
    }

    notify(`Deleted config ${clean}.`);
    return true;
  }

  function duplicate(from, to) {
    const data = store();
    const source = data[sanitizeName(from)];

    if (!source) {
      notify(`Config ${from || '?'} does not exist.`);
      return false;
    }

    const clean = sanitizeName(to);

    if (!clean) {
      notify('Config name is empty.');
      return false;
    }

    data[clean] = { ...source, name: clean, savedAt: Date.now() };
    writeStore(data);
    notify(`Created config ${clean}.`);
    return true;
  }

  /* ── disk mirror (extension bridge) ──────────────────────────────── */

  function bridge(action, payload) {
    return new Promise((resolve) => {
      if (!document.documentElement) {
        resolve(null);
        return;
      }

      const id = `cfg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      let done = false;

      const finish = (result) => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onResponse);
        resolve(result);
      };

      const onResponse = (event) => {
        if (event.source && event.source !== window) return;

        const data = event.data;

        if (!data || data.channel !== 'solstice-cfg-res' || data.id !== id) {
          return;
        }

        finish(data.result || null);
      };

      window.addEventListener('message', onResponse);
      setTimeout(() => finish(null), BRIDGE_TIMEOUT);

      try {
        window.postMessage({ channel: 'solstice-cfg', id, action, folder: FOLDER, ...payload }, '*');
      } catch {
        finish(null);
      }
    });
  }

  function fileBody(name) {
    const data = store();
    const config = data[sanitizeName(name)] || snapshot(name);
    return JSON.stringify(config, null, 2);
  }

  async function writeFile(name, content) {
    const clean = sanitizeName(name) || DEFAULT_NAME;
    const body = typeof content === 'string' ? content : fileBody(clean);
    const result = await bridge('write', { name: clean, content: body });

    if (result?.ok) {
      bridged = true;
      lastDiskAt = Date.now();
    }

    return Boolean(result?.ok);
  }

  function scheduleMirror() {
    if (mirrorTimer) return;

    mirrorTimer = setTimeout(() => {
      mirrorTimer = 0;
      writeFile(active());
    }, MIRROR_MS);
  }

  async function openFolder() {
    const result = await bridge('open-folder', {});

    if (result?.ok) {
      notify(result.item ? 'Opened the config folder.' : 'Opened your downloads folder.');
    } else {
      notify('Could not open the config folder.');
    }

    return Boolean(result?.ok);
  }

  /* ── import / export ────────────────────────────────────────────── */

  function downloadBlob(name, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizeName(name) || DEFAULT_NAME}.alwayswin`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      return true;
    } catch {
      return false;
    }
  }

  function exportFile(name) {
    const clean = sanitizeName(name) || active();
    const body = fileBody(clean);
    const ok = downloadBlob(clean, body);
    notify(ok ? `Exported ${clean}.alwayswin` : 'Export failed.');
    return ok;
  }

  function importFile() {
    return new Promise((resolve) => {
      try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.alwayswin,.solcod,.cfg,.json,application/json,text/plain';
        input.style.display = 'none';

        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          input.remove();

          if (!file) {
            resolve(null);
            return;
          }

          try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const name = sanitizeName(parsed?.name) || sanitizeName(file.name.replace(/\.(alwayswin|solcod|cfg)$/i, '')) || DEFAULT_NAME;

            if (!applySnapshot(parsed)) {
              throw new Error('no modules');
            }

            const clean = save(name, { mirror: true });
            notify(`Imported config ${clean}.`);
            resolve(clean);
          } catch {
            notify('That config file could not be read.');
            resolve(null);
          }
        }, { once: true });

        document.body.appendChild(input);
        input.click();
      } catch {
        resolve(null);
      }
    });
  }

  /* ── autosave ───────────────────────────────────────────────────── */

  function hashOf(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  function currentHash() {
    const snap = snapshot(active());
    delete snap.savedAt;
    return hashOf(snap);
  }

  function tick() {
    if (!autoSave) return;

    const hash = currentHash();

    if (hash === lastHash) return;

    lastHash = hash;

    const data = store();
    const clean = active() || DEFAULT_NAME;
    data[clean] = snapshot(clean);
    writeStore(data);
    scheduleMirror();
  }

  function startAutosave() {
    lastHash = currentHash();
    setInterval(tick, AUTOSAVE_MS);
  }

  /* ── legacy migration ───────────────────────────────────────────── */

  function migrateLegacy() {
    const legacy = readJson(LEGACY_STORE, null);

    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
      return;
    }

    const data = store();
    let changed = false;

    for (const [name, config] of Object.entries(legacy)) {
      const clean = sanitizeName(name);

      if (!clean || data[clean] || !Array.isArray(config?.modules)) {
        continue;
      }

      data[clean] = {
        version: VERSION,
        name: clean,
        savedAt: Number(config.savedAt) || Date.now(),
        modules: config.modules,
        binds: captureBinds(),
        hud: captureHud()
      };
      changed = true;
    }

    if (changed) {
      writeStore(data);
    }

    const legacyDefault = sanitizeName(localStorage.getItem(LEGACY_DEFAULT) || '');

    if (legacyDefault && !localStorage.getItem(ACTIVE_KEY)) {
      setActive(legacyDefault);
    }
  }

  function ensureDefault() {
    const data = store();

    if (Object.keys(data).length > 0) {
      return;
    }

    data[DEFAULT_NAME] = snapshot(DEFAULT_NAME);
    writeStore(data);
    setActive(DEFAULT_NAME);
  }

  /* ── boot ───────────────────────────────────────────────────────── */

  async function syncFromExtensionStorage() {
    try {
      const res = await bridge('storage-load', {});

      if (res?.ok && res.store && Object.keys(res.store).length > 0) {
        const current = store();
        const merged = { ...current, ...res.store };
        writeJson(STORE_KEY, merged);

        const targetName = sanitizeName(res.active) || active();

        if (merged[targetName]) {
          applySnapshot(merged[targetName]);
          setActive(targetName);
        }
      } else {
        await bridge('storage-save', { store: store(), active: active() });
      }
    } catch {

    }
  }

  function boot() {
    try {
      migrateLegacy();
      ensureDefault();

      const name = active();
      const config = store()[name];

      if (config) {
        applySnapshot(config);
        setActive(name);
      }

      startAutosave();
      syncFromExtensionStorage();

      /* 首次启动把 Default.solcod 写到 Downloads/Solstice/（同时创建文件夹） */
      setTimeout(() => {
        writeFile(active());
      }, 3000);
    } catch (error) {
      console.warn('[AlwaysWin] config boot failed', error);
    }
  }

  window.SolsticeConfig = {
    DEFAULT_NAME,
    FOLDER,
    list: names,
    active,
    setActive,
    snapshot,
    apply: applySnapshot,
    save,
    load,
    remove,
    duplicate,
    exportFile,
    importFile,
    openFolder,
    writeFile,
    store,
    notify,
    get autoSave() {
      return autoSave;
    },
    set autoSave(value) {
      autoSave = Boolean(value);
    },
    get saveHud() {
      return saveHud;
    },
    set saveHud(value) {
      saveHud = Boolean(value);
    },
    get saveBinds() {
      return saveBinds;
    },
    set saveBinds(value) {
      saveBinds = Boolean(value);
    },
    get diskLinked() {
      return bridged && Date.now() - lastDiskAt < 60000;
    }
  };

  boot();
})();
