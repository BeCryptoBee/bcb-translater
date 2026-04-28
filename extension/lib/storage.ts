export interface Settings {
  targetLang: string; // default 'uk'
  provider: 'auto' | 'gemini' | 'groq';
  userApiKey: string; // empty = use proxy
  showInlineOnTweets: boolean;
  theme: 'light' | 'dark';
}

const DEFAULTS: Settings = {
  targetLang: 'uk',
  provider: 'auto',
  userApiKey: '',
  showInlineOnTweets: true,
  theme: 'light',
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored } as Settings;
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

export function onSettingsChange(cb: (next: Settings) => void): () => void {
  const handler = async (
    _changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'sync') return;
    const next = await getSettings();
    cb(next);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
