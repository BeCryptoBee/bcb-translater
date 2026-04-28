import { handleProcess } from '~/lib/background-handler';
import { isProcessRequest } from '~/lib/messages';
import type { StorageAdapter } from '~/lib/cache';
import { getSettings } from '~/lib/storage';

const storeAdapter: StorageAdapter = {
  get: (keys) => chrome.storage.local.get(keys) as Promise<Record<string, unknown>>,
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
};

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isProcessRequest(msg)) return false;
    handleProcess(msg, storeAdapter).then(sendResponse);
    return true; // keep channel open for async response
  });

  // (Re-)create context menus on install / update / browser start. Removing
  // first avoids the "Cannot create item with duplicate id" error when the
  // service worker restarts after a manual refresh.
  const buildMenus = (): void => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'bcb-root',
        title: 'BCB Translate',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: 'bcb-translate',
        parentId: 'bcb-root',
        title: 'Translate selection',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: 'bcb-summarize',
        parentId: 'bcb-root',
        title: 'Summary selection',
        contexts: ['selection'],
      });
    });
  };
  chrome.runtime.onInstalled.addListener(buildMenus);
  chrome.runtime.onStartup.addListener(buildMenus);

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id || !info.selectionText) return;
    const id = String(info.menuItemId);
    if (id !== 'bcb-translate' && id !== 'bcb-summarize') return;
    const mode = id === 'bcb-translate' ? 'translate' : 'summarize';
    chrome.tabs.sendMessage(tab.id, {
      type: 'trigger-action',
      mode,
      text: info.selectionText,
    });
  });

  chrome.commands.onCommand.addListener(async (cmd) => {
    // Hotkeys are off by default and only fire when the user has explicitly
    // enabled them in settings. We can't dynamically unregister chrome.commands,
    // so we just gate the dispatch here.
    const settings = await getSettings();
    if (!settings.enableHotkeys) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const mode = cmd === 'translate-selection' ? 'translate' : 'summarize';
    chrome.tabs.sendMessage(tab.id, { type: 'trigger-action', mode });
  });
});
