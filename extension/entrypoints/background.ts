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
});
