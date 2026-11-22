'use strict';

importScripts('/extension/protocol.js');

const Protocol = globalThis.SolsticeProtocol;

const CFG_TYPE = 'solstice/cfg';
const CFG_FOLDER = 'Solstice';
const CFG_EXT = '.solcod';

async function toggleForTab(tab) {
  if (!Protocol || !tab?.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(
      tab.id,
      Protocol.extensionMessage(Protocol.MESSAGES.TOGGLE)
    );
  } catch {

  }
}

function safeName(value) {
  const clean = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 40);

  return clean || 'Default';
}

function folderOf(value) {
  const clean = String(value || '')
    .replace(/[\\/:*?"<>|.\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 32);

  return clean || CFG_FOLDER;
}

/* 下载 1 个 Blob URL，冲突时覆盖同名文件（文件夹会被自动创建） */
async function writeConfigFile(message) {
  const folder = folderOf(message.folder);
  const name = safeName(message.name);
  const content = typeof message.content === 'string' ? message.content : '{}';
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  try {
    const id = await chrome.downloads.download({
      url,
      filename: `${folder}/${name}${CFG_EXT}`,
      conflictAction: 'overwrite',
      saveAs: false
    });

    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { ok: true, id, filename: `${folder}/${name}${CFG_EXT}` };
  } catch (error) {
    URL.revokeObjectURL(url);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

/* 在资源管理器里定位最后一个 .cfg；没有的话退回下载文件夹 */
async function openConfigFolder(message) {
  const folder = folderOf(message.folder);

  try {
    const items = await chrome.downloads.search({
      limit: 40,
      orderBy: ['-startTime'],
      query: [folder]
    });

    const match = items.find((item) => String(item.filename || '').toLowerCase().includes(folder.toLowerCase()));

    if (match) {
      chrome.downloads.show(match.id);
      return { ok: true, item: match.filename };
    }

    chrome.downloads.showDefaultFolder();
    return { ok: true, item: null };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

async function handleConfigMessage(message) {
  if (message.action === 'storage-load') {
    try {
      const res = await chrome.storage.local.get(['solstice_cfg_store', 'solstice_cfg_active']);
      return {
        ok: true,
        store: res.solstice_cfg_store && typeof res.solstice_cfg_store === 'object' ? res.solstice_cfg_store : null,
        active: typeof res.solstice_cfg_active === 'string' ? res.solstice_cfg_active : ''
      };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  }

  if (message.action === 'storage-save') {
    try {
      const payload = {};

      if (message.store && typeof message.store === 'object') {
        payload.solstice_cfg_store = message.store;
      }

      if (typeof message.active === 'string' && message.active) {
        payload.solstice_cfg_active = message.active;
      }

      await chrome.storage.local.set(payload);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  }

  if (message.action === 'write') {
    return writeConfigFile(message);
  }

  if (message.action === 'open-folder') {
    return openConfigFolder(message);
  }

  if (message.action === 'list') {
    try {
      const folder = folderOf(message.folder);
      const items = await chrome.downloads.search({
        limit: 100,
        orderBy: ['-startTime'],
        query: [folder]
      });

      const files = items
        .filter((item) => String(item.filename || '').toLowerCase().includes(folder.toLowerCase()))
        .map((item) => String(item.filename || '').split(/[\\/]/).pop());

      return { ok: true, files };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  }

  return { ok: false, error: `unknown action ${message.action}` };
}

if (Protocol) {
  chrome.action.onClicked.addListener((tab) => {
    toggleForTab(tab);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== CFG_TYPE) {
    return false;
  }

  handleConfigMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));

  return true;
});
