(() => {
  'use strict';

  /* 配置面板：把配置引擎做成 ClickGui 里的一组开关。
     一次性开关（Save / Load / Delete / Export / Import / Open Folder）
     点一下触发后立刻弹回关。 */

  function engine() {
    return window.SolsticeConfig || null;
  }

  function button(name) {
    const module = getMod('Config');
    return module ? module.settings.find((entry) => entry.n === name) : null;
  }

  function pressed(name) {
    const setting = button(name);

    if (!setting || !setting.v) {
      return false;
    }

    setting.v = 0;
    setting.bs = 0;
    return true;
  }

  function selectedConfig() {
    const setting = button('Config');
    const api = engine();

    if (!setting || !api) {
      return 'Default';
    }

    return setting.vals[setting.v] || api.DEFAULT_NAME;
  }

  function syncConfigList() {
    const api = engine();
    const setting = button('Config');

    if (!api || !setting) {
      return;
    }

    let list = api.list();

    if (list.length === 0) {
      list = [api.DEFAULT_NAME];
    }

    if (setting.vals.length !== list.length || setting.vals.join('\n') !== list.join('\n')) {
      const current = setting.vals[setting.v];
      setting.vals = list.slice();
      const index = list.indexOf(current);
      setting.v = index >= 0 ? index : 0;
    }

    if (!Number.isInteger(setting.v) || setting.v < 0 || setting.v >= setting.vals.length) {
      setting.v = 0;
    }
  }

  function syncFlags(api) {
    const auto = button('Autosave');
    const hud = button('Save Hud');
    const binds = button('Save Binds');

    if (auto && api.autoSave !== Boolean(auto.v)) api.autoSave = Boolean(auto.v);
    if (hud && api.saveHud !== Boolean(hud.v)) api.saveHud = Boolean(hud.v);
    if (binds && api.saveBinds !== Boolean(binds.v)) api.saveBinds = Boolean(binds.v);
  }

  function draw() {
    const api = engine();

    if (!api) {
      return;
    }

    syncConfigList();

    const name = selectedConfig();

    if (pressed('Save')) api.save(name);
    if (pressed('Rename')) {
      const next = window.prompt('Rename config:', name);
      if (next !== null && next.trim()) {
        const renamed = api.rename(name, next.trim());
        if (renamed) {
          syncConfigList();
          const sel = button('Config');
          const idx = sel ? sel.vals.indexOf(next.trim()) : -1;
          if (sel && idx >= 0) sel.v = idx;
        }
      }
    }
    if (pressed('Export')) api.exportFile(name);
    if (pressed('Import')) api.importFile();
  }

  register({
    name: 'Config',
    desc: 'Saves, renames, exports and imports your configs.',
    cat: 'Misc',
    nm: { l: 'config', ls: 'config', n: 'Config', ns: 'Config' },
    disp: 'Config',
    settings: [
      { t: 'e', n: 'Config', d: 'The configuration to work on.', v: 0, vals: ['Default'] },
      { t: 'b', n: 'Save', d: 'Writes the current setup into the selected config.', v: 0 },
      { t: 'b', n: 'Rename', d: 'Renames the selected config.', v: 0 },
      { t: 'b', n: 'Export', d: 'Downloads the selected config as a .cfg file.', v: 0 },
      { t: 'b', n: 'Import', d: 'Loads a .cfg file from disk.', v: 0 }
    ],
    renderOrder: 4,
    defaultOn: true,
    onInit(mod) {
      mod.locked = true;
      const vis = mod.settings.find((entry) => entry.n === 'Visible');
      if (vis) {
        vis.v = 0;
        vis.bs = 0;
      }
    },
    onRender: draw,
    onEnable() {}
  });
})();
