(() => {
  'use strict';

  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const IS_POTATO = (typeof window !== 'undefined' && window.SolsticeGameId === 'potatoepic') || location.pathname.includes('/potatoepic/');
  const CONFIG_KEY = IS_POTATO ? 'solstice.potato.configs' : 'solstice.configs';
  const DEFAULT_KEY = IS_POTATO ? 'solstice.potato.config.default' : 'solstice.config.default';
  const BIND_KEY = IS_POTATO ? 'solstice.potato.binds' : 'solstice.binds';
  const CONFIG_VERSION = 1;
  const COMMANDS = [
    {
      name: 'help',
      aliases: ['?'],
      description: 'Displays a list of available commands',
      usage: 'help [command]'
    },
    {
      name: 'bind',
      aliases: ['b'],
      description: 'Binds a module to a key',
      usage: 'bind [module] [key]'
    },
    {
      name: 'config',
      aliases: ['c'],
      description: 'Manage configurations',
      usage: 'config <load/save/list/delete/default/folder/export/import> [name]'
    },
    {
      name: 'fatality',
      aliases: ['splash'],
      description: 'Plays the injection splash animation',
      usage: 'fatality [word]'
    }
  ];
  const NAMED_KEYS = {
    space: 'Space',
    shift: 'ShiftLeft',
    lshift: 'ShiftLeft',
    rshift: 'ShiftRight',
    ctrl: 'ControlLeft',
    control: 'ControlLeft',
    alt: 'AltLeft',
    tab: 'Tab',
    enter: 'Enter',
    return: 'Enter',
    backspace: 'Backspace',
    delete: 'Delete',
    del: 'Delete',
    insert: 'Insert',
    ins: 'Insert',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    capslock: 'CapsLock',
    escape: 'Escape',
    esc: 'Escape',
    '`': 'Backquote',
    '-': 'Minus',
    '=': 'Equal',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '\\': 'Backslash',
    ';': 'Semicolon',
    "'": 'Quote',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash'
  };
  const KEY_LABELS = {
    Space: 'Space',
    ShiftLeft: 'Shift',
    ShiftRight: 'RShift',
    ControlLeft: 'Ctrl',
    ControlRight: 'RCtrl',
    AltLeft: 'Alt',
    AltRight: 'RAlt',
    Tab: 'Tab',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    CapsLock: 'CapsLock',
    Escape: 'Escape',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/'
  };
  const LEGACY_KEYS = {
    27: 'Escape',
    32: 'Space',
    45: 'Insert',
    9: 'Tab',
    13: 'Enter',
    8: 'Backspace',
    46: 'Delete',
    36: 'Home',
    35: 'End',
    33: 'PageUp',
    34: 'PageDown',
    37: 'ArrowLeft',
    38: 'ArrowUp',
    39: 'ArrowRight',
    40: 'ArrowDown',
    16: 'ShiftLeft',
    17: 'ControlLeft',
    18: 'AltLeft'
  };

  let lastLoaded = '';
  let lastTrigger = '';
  let lastTriggerAt = 0;
  let gamePlaying = false;

  function log(...args) {
    console.log('%c[Solstice]', 'color:#ff5fa2;font-weight:bold', ...args);
  }

  function warn(...args) {
    console.warn('%c[Solstice]', 'color:#ffb347;font-weight:bold', ...args);
  }

  function error(...args) {
    console.error('%c[Solstice]', 'color:#ff4d4d;font-weight:bold', ...args);
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null') || fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      error(`Failed to write localStorage: ${e.message}`);
      return false;
    }
  }

  function commandInfo(name) {
    const lower = String(name || '').toLowerCase();
    return COMMANDS.find((command) => command.name === lower || command.aliases.includes(lower));
  }

  function moduleByName(name) {
    const lower = String(name || '').toLowerCase();
    return MODS.find((mod) => mod.name.toLowerCase() === lower) ||
      MODS.find((mod) => mod.nm?.n?.toLowerCase() === lower) ||
      null;
  }

  function normalizeCode(value) {
    if (typeof value === 'string') {
      if (value.startsWith('Key') || value.startsWith('Digit') || value.startsWith('F') ||
          value.startsWith('Arrow') || value.startsWith('Numpad') || KEY_LABELS[value]) {
        return value;
      }
    }

    if (typeof value === 'number') {
      return LEGACY_KEYS[value] || `KeyCode${value}`;
    }

    return String(value || '');
  }

  const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  const MOUSE_CODES = { mouse3: 'Mouse3', mouse4: 'Mouse4', mouse5: 'Mouse5', m3: 'Mouse3', m4: 'Mouse4', m5: 'Mouse5' };
  const RESERVED_MODS = { ctrl: true, alt: true, meta: true };

  /* 把 "Ctrl+Shift+KeyA" 拆成 { mods, code } */
  function splitBind(value) {
    const raw = String(value || '').trim();

    if (!raw) {
      return null;
    }

    const parts = raw.split('+');
    const code = parts.pop() || '';
    const mods = { ctrl: false, alt: false, shift: false, meta: false };

    for (const part of parts) {
      const token = part.toLowerCase();

      if (token === 'ctrl' || token === 'control') {
        mods.ctrl = true;
      } else if (token === 'alt' || token === 'option') {
        mods.alt = true;
      } else if (token === 'shift') {
        mods.shift = true;
      } else if (token === 'meta' || token === 'win' || token === 'super' || token === 'cmd') {
        mods.meta = true;
      } else {
        return null;
      }
    }

    return code ? { mods, code } : null;
  }

  function joinBind(mods, code) {
    const parts = [];

    for (const name of MODIFIER_ORDER) {
      if (mods[name.toLowerCase()]) {
        parts.push(name);
      }
    }

    return parts.length ? `${parts.join('+')}+${code}` : code;
  }

  function hasReservedModifier(value) {
    const parsed = splitBind(value);
    return Boolean(parsed && (parsed.mods.ctrl || parsed.mods.alt || parsed.mods.meta));
  }

  function sameBaseCode(a, b) {
    if (a === b) {
      return true;
    }

    const groups = [
      ['ShiftLeft', 'ShiftRight'],
      ['ControlLeft', 'ControlRight'],
      ['AltLeft', 'AltRight'],
      ['MetaLeft', 'MetaRight']
    ];

    for (const group of groups) {
      if (group.includes(a) && group.includes(b)) {
        return true;
      }
    }

    return false;
  }

  /* 事件 → 规范化绑定串（含修饰键） */
  function bindFromEvent(event) {
    const code = event.code || normalizeCode(event.keyCode);
    const mods = {
      ctrl: Boolean(event.ctrlKey),
      alt: Boolean(event.altKey),
      shift: Boolean(event.shiftKey),
      meta: Boolean(event.metaKey)
    };

    return joinBind(mods, code);
  }

  function mouseBindFromEvent(event) {
    if (event.button === 1) return joinBind({ ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey }, 'Mouse3');
    if (event.button === 3) return joinBind({ ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey }, 'Mouse4');
    if (event.button === 4) return joinBind({ ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey }, 'Mouse5');
    return '';
  }

  function baseFromToken(raw) {
    const lower = raw.toLowerCase();

    if (NAMED_KEYS[lower]) return NAMED_KEYS[lower];
    if (MOUSE_CODES[lower]) return MOUSE_CODES[lower];
    if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(raw)) return raw.toUpperCase();
    if (/^key[a-z]$/i.test(raw)) return `Key${raw.slice(-1).toUpperCase()}`;
    if (/^digit[0-9]$/i.test(raw)) return `Digit${raw.slice(-1)}`;
    if (/^numpad[0-9]$/i.test(raw)) return `Numpad${raw.slice(-1)}`;
    if (/^num[0-9]$/i.test(raw)) return `Numpad${raw.slice(-1)}`;
    if (/^[a-z]$/i.test(raw)) return `Key${raw.toUpperCase()}`;
    if (/^[0-9]$/.test(raw)) return `Digit${raw}`;

    return null;
  }

  function parseKey(input) {
    if (input === undefined || input === null) {
      return null;
    }

    const raw = String(input).trim();

    if (!raw) {
      return null;
    }

    const lower = raw.toLowerCase();

    if (lower === 'none' || lower === '0') {
      return 0;
    }

    const parts = raw.split('+');
    const keyToken = parts.pop() || '';
    const mods = { ctrl: false, alt: false, shift: false, meta: false };

    for (const part of parts) {
      const token = part.toLowerCase();

      if (token === 'ctrl' || token === 'control') {
        mods.ctrl = true;
      } else if (token === 'alt' || token === 'option') {
        mods.alt = true;
      } else if (token === 'shift') {
        mods.shift = true;
      } else if (token === 'meta' || token === 'win' || token === 'super' || token === 'cmd') {
        mods.meta = true;
      } else {
        return null;
      }
    }

    const code = baseFromToken(keyToken);

    if (!code) {
      return null;
    }

    return joinBind(mods, code);
  }

  function baseLabel(code) {
    if (KEY_LABELS[code]) {
      return KEY_LABELS[code];
    }

    if (code.startsWith('Key') && code.length === 4) {
      return code.slice(3);
    }

    if (code.startsWith('Digit') && code.length === 6) {
      return code.slice(5);
    }

    if (code === 'Mouse3') return 'M3';
    if (code === 'Mouse4') return 'M4';
    if (code === 'Mouse5') return 'M5';

    return code;
  }

  function keyLabel(key) {
    if (!key || key === 0) {
      return 'None';
    }

    const parsed = splitBind(key);

    if (!parsed) {
      return baseLabel(normalizeCode(key));
    }

    const mods = [];

    if (parsed.mods.ctrl) mods.push('Ctrl');
    if (parsed.mods.alt) mods.push('Alt');
    if (parsed.mods.shift) mods.push('Shift');
    if (parsed.mods.meta) mods.push('Win');

    const base = baseLabel(normalizeCode(parsed.code));
    return mods.length ? `${mods.join('+')}+${base}` : base;
  }

  /* 修饰键必须完全一致：绑在 A 上就不会被 Ctrl+A 触发 */
  function keyMatches(key, incoming) {
    if (!key || !incoming) {
      return false;
    }

    const stored = splitBind(key);
    const pressed = splitBind(incoming);

    if (!stored || !pressed) {
      return sameBaseCode(normalizeCode(key), normalizeCode(incoming));
    }

    if (stored.mods.ctrl !== pressed.mods.ctrl ||
        stored.mods.alt !== pressed.mods.alt ||
        stored.mods.shift !== pressed.mods.shift ||
        stored.mods.meta !== pressed.mods.meta) {
      return false;
    }

    return sameBaseCode(stored.code, pressed.code);
  }

  function saveBinds() {
    const binds = {};

    for (const mod of MODS) {
      if (mod.key || mod.bindMode === 'hold') {
        binds[mod.name] = mod.bindMode === 'hold'
          ? { key: mod.key || 0, mode: 'hold' }
          : mod.key;
      }
    }

    writeJson(BIND_KEY, binds);
  }

  function loadBinds() {
    const binds = readJson(BIND_KEY, {});

    for (const [name, entry] of Object.entries(binds)) {
      const mod = moduleByName(name);

      if (mod) {
        if (entry && typeof entry === 'object') {
          mod.key = entry.key || 0;
          mod.bindMode = entry.mode === 'hold' ? 'hold' : 'toggle';
        } else {
          mod.key = entry || 0;
          mod.bindMode = 'toggle';
        }
      }
    }
  }

  function saveModuleBind(mod) {
    if (mod) {
      saveBinds();
    }
  }

  function guardValue(name, fallback) {
    const module = getMod('InputGuard');
    const setting = module && module.settings.find((entry) => entry.n === name);
    return setting ? Boolean(setting.v) : fallback;
  }

  /* 返回是否真的触发了模块（true 时调用方吞掉这个事件） */
  function triggerBound(bind) {
    if (!bind || bind === 'Insert' || bind === 'Escape') {
      return false;
    }

    if (S.open || S.hudEditor || S.binding || S.bindBool) {
      return false;
    }

    const parsed = splitBind(bind);

    if (!parsed) {
      return false;
    }

    /* 带 Ctrl / Alt / Win 的组合一律不触发：那些是浏览器和系统的地盘 */
    if (parsed.mods.ctrl || parsed.mods.alt || parsed.mods.meta) {
      return false;
    }

    if (parsed.code.startsWith('Mouse') && !guardValue('Mouse Binds', true)) {
      return false;
    }

    if (guardValue('In Game Only', false) && !gamePlaying) {
      return false;
    }

    const now = performance.now();

    if (bind === lastTrigger && now - lastTriggerAt < 80) {
      return false;
    }

    lastTrigger = bind;
    lastTriggerAt = now;

    let fired = false;

    for (const mod of MODS) {
      if (mod.name === 'ClickGui') {
        continue;
      }

      if (keyMatches(mod.key, bind)) {
        if (mod.bindMode === 'hold') {
          if (!mod.on) {
            setModuleOn(mod, true);
          }
        } else {
          setModuleOn(mod, !mod.on);
        }
        fired = true;
      }
    }

    return fired;
  }

  function releaseBound(bind) {
    if (!bind || bind === 'Insert' || bind === 'Escape') {
      return false;
    }

    if (S.open || S.hudEditor || S.binding || S.bindBool) {
      return false;
    }

    const parsed = splitBind(bind);

    if (!parsed) {
      return false;
    }

    let released = false;

    for (const mod of MODS) {
      if (mod.name === 'ClickGui' || mod.bindMode !== 'hold' || !mod.key || !mod.on) {
        continue;
      }

      const modParsed = splitBind(mod.key);

      if (modParsed && modParsed.code === parsed.code) {
        setModuleOn(mod, false);
        released = true;
      }
    }

    return released;
  }

  function commandHelp(name) {
    if (name) {
      const command = commandInfo(name);

      if (!command) {
        error(`The command '${name}' does not exist.`);
        return;
      }

      log(`Command: ${command.name}`);
      log(`- ${command.description}`);
      log(`- Usage: ${command.usage}`);
      log(`- Aliases: ${command.aliases.join(', ') || 'none'}`);
      return;
    }

    console.table(COMMANDS.map((command) => ({
      Command: command.name,
      Aliases: command.aliases.join(', '),
      Description: command.description
    })));
    log('Use help <command> for more information.');
  }

  function commandBind(moduleName, keyName) {
    if (!moduleName) {
      const list = MODS
        .filter((mod) => mod.key)
        .map((mod) => ({
          Module: mod.name,
          Key: keyLabel(mod.key)
        }));

      if (list.length === 0) {
        log('No binds.');
        return;
      }

      console.table(list);
      log('Use bind <module> <key> to bind a module.');
      return;
    }

    const mod = moduleByName(moduleName);

    if (!mod) {
      error(`The module '${moduleName}' does not exist.`);
      return;
    }

    if (keyName === undefined) {
      log(`${mod.name} is currently bound to ${keyLabel(mod.key)}.`);
      return;
    }

    const key = parseKey(keyName);

    if (key === null) {
      error(`Unknown key '${keyName}'.`);
      return;
    }

    if (key && hasReservedModifier(key)) {
      error('Ctrl / Alt / Win combos belong to the browser and the OS. Bind a plain key, a Shift combo, or Mouse4 / Mouse5.');
      return;
    }

    mod.key = key;
    saveBinds();
    log(`${mod.name} is now bound to ${keyLabel(key)}.`);
  }

  /* ── config: 全部委托给 js/config.js 的引擎 ───────────────────── */

  function engine() {
    return window.SolsticeConfig || null;
  }

  function loadConfig(name, quiet = false) {
    const api = engine();

    if (!api) {
      return false;
    }

    return api.load(name || api.active(), { silent: quiet });
  }

  function saveConfig(name, overwrite = false, quiet = false) {
    const api = engine();

    if (!api) {
      return false;
    }

    const clean = String(name || '').trim() || api.active();
    const exists = api.list().includes(clean);

    if (exists && !overwrite && !quiet) {
      warn(`Configuration '${clean}' already exists. Use config save ${clean} overwrite.`);
      return false;
    }

    api.save(clean, { silent: quiet });
    return true;
  }

  function listConfigs() {
    const api = engine();

    if (!api) {
      return;
    }

    const names = api.list();
    const active = api.active();

    if (names.length === 0) {
      log('No configurations.');
      return;
    }

    console.table(names.map((name) => ({
      Name: name,
      Active: name === active ? 'yes' : ''
    })));

    log('Use config load <name> to apply one.');
  }

  function deleteConfig(name) {
    engine()?.remove(name);
  }

  function setDefaultConfig(name) {
    const api = engine();

    if (!api) {
      return;
    }

    if (!name) {
      log('Usage: config default <name>');
      return;
    }

    if (!api.list().includes(name)) {
      error(`The configuration '${name}' does not exist.`);
      return;
    }

    api.setActive(name);
    log(`The default configuration is now ${name}.`);
  }

  function commandConfig(action, name, extra) {
    const api = engine();

    if (!api) {
      error('The configuration engine is not loaded.');
      return;
    }

    if (!action) {
      error(COMMANDS.find((command) => command.name === 'config').usage);
      return;
    }

    const verb = String(action).toLowerCase();

    if (verb === 'load' || verb === 'l') {
      if (!name) {
        error('Usage: config load <name>');
        return;
      }

      loadConfig(name);
    } else if (verb === 'save' || verb === 's') {
      saveConfig(name, extra === 'overwrite');
    } else if (verb === 'list' || verb === 'ls') {
      listConfigs();
    } else if (verb === 'delete' || verb === 'del') {
      if (!name) {
        error('Usage: config delete <name>');
        return;
      }

      deleteConfig(name);
    } else if (verb === 'default' || verb === 'd') {
      setDefaultConfig(name);
    } else if (verb === 'folder' || verb === 'open') {
      api.openFolder();
    } else if (verb === 'export') {
      api.exportFile(name || api.active());
    } else if (verb === 'import') {
      api.importFile();
    } else {
      error(COMMANDS.find((command) => command.name === 'config').usage);
    }
  }

  function commandFatality(word) {
    const play = window.solsticeSplash;

    if (typeof play !== 'function') {
      error('The splash module is not loaded.');
      return;
    }

    play(word);
    log(word ? `Playing the splash with '${word}'.` : 'Playing the splash.');
  }

  function parseLine(line) {
    let text = String(line || '').trim();

    if (text.startsWith('.')) {
      text = text.slice(1);
    }

    const parts = [];
    const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;

    while ((match = pattern.exec(text))) {
      parts.push(match[1] ?? match[2] ?? match[3]);
    }

    return parts;
  }

  function execute(line) {
    const parts = parseLine(line);

    if (parts.length === 0) {
      return;
    }

    const command = commandInfo(parts[0]);

    if (!command) {
      error(`The command '${parts[0]}' does not exist.`);
      return;
    }

    if (command.name === 'help') {
      commandHelp(parts[1]);
    } else if (command.name === 'bind') {
      commandBind(parts[1], parts[2]);
    } else if (command.name === 'config') {
      commandConfig(parts[1], parts[2], parts[3]);
    } else if (command.name === 'fatality') {
      commandFatality(parts[1]);
    }
  }

  function isGameSource(source) {
    for (const frame of document.querySelectorAll('iframe')) {
      if (
        (frame.src.startsWith(`${GAME_ORIGIN}/toy/golden-hour/`) ||
         frame.src.startsWith(`${GAME_ORIGIN}/toy/potatoepic/`)) &&
        frame.contentWindow === source
      ) {
        return true;
      }
    }

    return false;
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat || S.open || S.hudEditor || S.binding || S.bindBool) {
      return;
    }

    const target = event.target;

    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
    ) {
      return;
    }

    if (triggerBound(bindFromEvent(event))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  /* 鼠标侧键 / 中键也能当绑定键 */
  window.addEventListener('mousedown', (event) => {
    if (event.repeat || S.open || S.hudEditor || S.binding || S.bindBool) {
      return;
    }

    const bind = mouseBindFromEvent(event);

    if (!bind) {
      return;
    }

    if (triggerBound(bind)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('keyup', (event) => {
    if (S.open || S.hudEditor || S.binding || S.bindBool) {
      return;
    }

    if (releaseBound(bindFromEvent(event))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('mouseup', (event) => {
    if (S.open || S.hudEditor || S.binding || S.bindBool) {
      return;
    }

    const bind = mouseBindFromEvent(event);

    if (bind && releaseBound(bind)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('message', (event) => {
    if (event.origin !== GAME_ORIGIN || !isGameSource(event.source)) {
      return;
    }

    const data = event.data;

    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.channel === 'solstice-input' && data.type === 'state') {
      gamePlaying = Boolean(data.playing);
      return;
    }

    if (data.channel === 'solstice-key' && data.type === 'down') {
      const mods = {
        ctrl: Boolean(data.ctrl),
        alt: Boolean(data.alt),
        shift: Boolean(data.shift),
        meta: Boolean(data.meta)
      };
      const bind = joinBind(mods, normalizeCode(data.code || data.key));

      if (triggerBound(bind)) {
        /* 游戏 iframe 已经吞掉了事件，这里不需要额外操作 */
        return;
      }
    }

    if (data.channel === 'solstice-key' && data.type === 'up') {
      const mods = {
        ctrl: Boolean(data.ctrl),
        alt: Boolean(data.alt),
        shift: Boolean(data.shift),
        meta: Boolean(data.meta)
      };
      const bind = joinBind(mods, normalizeCode(data.code || data.key));
      releaseBound(bind);
    }
  });

  loadBinds();

  /* 配置在 js/config.js 里已经于启动第一步加载完毕，这里只补一次绑定同步 */
  window.Solstice = {
    help: commandHelp,
    bind: commandBind,
    config: commandConfig,
    fatality: commandFatality,
    execute,
    saveModuleBind,
    commands: COMMANDS.map((command) => command.name)
  };

  if (window.SolsticeConfig) {
    window.Solstice.configs = window.SolsticeConfig;
  }

  /* 给 main.js 的绑定捕获用 */
  window.SolsticeKeys = {
    parseKey,
    keyLabel,
    bindFromEvent,
    mouseBindFromEvent,
    keyMatches,
    splitBind,
    hasReservedModifier
  };
  window.aww = execute;

  if (typeof window.help === 'undefined') {
    window.help = commandHelp;
  }

  if (typeof window.bind === 'undefined') {
    window.bind = commandBind;
  }

  if (typeof window.config === 'undefined') {
    window.config = commandConfig;
  }

  if (!window.__solsticeConsoleHint) {
    window.__solsticeConsoleHint = true;
    console.log(
      '%c[AlwaysWin]%c Console commands: aww("help") | aww("bind Aura R") | aww("config save main")',
      'color:#ff5fa2;font-weight:bold',
      'color:inherit'
    );
  }
})();
