export interface Settings {
  targetLang: string; // default 'uk'
  provider: 'auto' | 'gemini' | 'groq';
  userApiKey: string; // empty = use proxy
  showInlineOnTweets: boolean;
  theme: 'light' | 'dark' | 'auto';
  enableHotkeys: boolean; // false by default — Alt+T / Alt+S off until user opts in
  tweetButtonColor: string; // CSS color for the inline button text on tweets
  translationHighlight: boolean; // sentence-aligned hover highlight; ~10–15% more tokens
}

const DEFAULTS: Settings = {
  targetLang: 'uk',
  provider: 'auto',
  userApiKey: '',
  showInlineOnTweets: true,
  theme: 'auto',
  enableHotkeys: false,
  tweetButtonColor: '#9ca3af',
  translationHighlight: false,
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

/**
 * Resolve the configured theme to a concrete value. When the theme is "auto",
 * follow the system preference via prefers-color-scheme. Safe to call from
 * any context that has window.matchMedia (content scripts, popup).
 */
export function resolveTheme(theme: Settings['theme']): 'light' | 'dark' {
  if (theme !== 'auto') return theme;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
