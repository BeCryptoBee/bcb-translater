const PREFIX = 'quota_';

function todayKey(): string {
  return PREFIX + new Date().toISOString().slice(0, 10);
}

export async function getLocalQuota(): Promise<number> {
  const k = todayKey();
  const got = await chrome.storage.local.get([k]);
  return Number(got[k] ?? 0);
}

export async function incrementLocalQuota(): Promise<void> {
  const k = todayKey();
  const got = await chrome.storage.local.get([k]);
  await chrome.storage.local.set({ [k]: Number(got[k] ?? 0) + 1 });
}
