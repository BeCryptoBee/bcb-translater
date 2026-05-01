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
    handleProcess(msg, storeAdapter)
      .then(sendResponse)
      .catch((e) => {
        // Don't leak unhandled rejections into the SW error log; surface
        // a structured error to the caller instead.
        console.error('[bcb] handleProcess crashed:', e);
        try {
          sendResponse({
            ok: false,
            code: 'unknown',
            message: 'Internal error — please try again.',
          });
        } catch {
          /* sendResponse channel may be closed; nothing to do. */
        }
      });
    return true; // keep channel open for async response
  });

  // (Re-)create context menus on install / update / browser start. Removing
  // first avoids the "Cannot create item with duplicate id" error when the
  // service worker restarts after a manual refresh. Each create() also
  // passes a callback that swallows chrome.runtime.lastError, because
  // onInstalled and onStartup can fire close together (or interleave with
  // a SW wakeup) and we don't want a benign "duplicate id" warning
  // bleeding into runtime.lastError for unrelated callers.
  const swallowLastError = (): void => {
    void chrome.runtime.lastError;
  };
  const buildMenus = (): void => {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      chrome.contextMenus.create(
        { id: 'bcb-root', title: 'BCB Translate', contexts: ['selection'] },
        swallowLastError,
      );
      chrome.contextMenus.create(
        {
          id: 'bcb-translate',
          parentId: 'bcb-root',
          title: 'Translate selection',
          contexts: ['selection'],
        },
        swallowLastError,
      );
      chrome.contextMenus.create(
        {
          id: 'bcb-summarize',
          parentId: 'bcb-root',
          title: 'Summary selection',
          contexts: ['selection'],
        },
        swallowLastError,
      );
    });
  };
  chrome.runtime.onInstalled.addListener(buildMenus);
  chrome.runtime.onStartup.addListener(buildMenus);

  // After an extension update / reload, every tab that was already open
  // still hosts the OLD content script, which Chrome has already detached
  // from chrome.runtime — sendMessage to it silently fails. Re-inject a
  // fresh content script into every eligible tab so the right-click menu
  // and hotkeys work without asking the user to F5 each tab.
  const reinjectAllTabs = async (): Promise<void> => {
    let tabs: chrome.tabs.Tab[] = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return;
    }
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      if (!/^https?:\/\//i.test(tab.url)) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          files: ['content-scripts/content.js'],
        });
      } catch {
        // Tab may be a chrome:// page, the web store, etc. — ignore.
      }
    }
  };
  chrome.runtime.onInstalled.addListener(reinjectAllTabs);

  // Try to send a trigger-action message; if no listener (stale tab), inject
  // the content script once and retry. Single fallback, no retry storm.
  const sendTrigger = async (
    tabId: number,
    payload: { type: 'trigger-action'; mode: 'translate' | 'summarize'; text?: string },
  ): Promise<void> => {
    try {
      await chrome.tabs.sendMessage(tabId, payload);
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          files: ['content-scripts/content.js'],
        });
        // Give the freshly-injected listener a moment to attach.
        await new Promise((r) => setTimeout(r, 50));
        await chrome.tabs.sendMessage(tabId, payload);
      } catch (e) {
        console.error('[bcb] context menu / hotkey: cannot deliver to tab', tabId, e);
      }
    }
  };

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id || !info.selectionText) return;
    const id = String(info.menuItemId);
    if (id !== 'bcb-translate' && id !== 'bcb-summarize') return;
    const mode = id === 'bcb-translate' ? 'translate' : 'summarize';
    void sendTrigger(tab.id, {
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
    void sendTrigger(tab.id, { type: 'trigger-action', mode });
  });
});
