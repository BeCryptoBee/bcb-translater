import { handleProcess } from '~/lib/background-handler';
import { isProcessRequest } from '~/lib/messages';
import type { StorageAdapter } from '~/lib/cache';

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

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'bcb-translate',
      title: 'Translate selection',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'bcb-summarize',
      title: 'Summarize selection',
      contexts: ['selection'],
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id || !info.selectionText) return;
    const mode = String(info.menuItemId) === 'bcb-translate' ? 'translate' : 'summarize';
    chrome.tabs.sendMessage(tab.id, {
      type: 'trigger-action',
      mode,
      text: info.selectionText,
    });
  });

  chrome.commands.onCommand.addListener(async (cmd) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const mode = cmd === 'translate-selection' ? 'translate' : 'summarize';
    chrome.tabs.sendMessage(tab.id, { type: 'trigger-action', mode });
  });
});
