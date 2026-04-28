const KEY = 'install_id';

export async function getInstallId(): Promise<string> {
  const got = await chrome.storage.local.get([KEY]);
  if (typeof got[KEY] === 'string') return got[KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [KEY]: id });
  return id;
}
