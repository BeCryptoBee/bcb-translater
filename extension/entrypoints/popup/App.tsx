import { useEffect, useState } from 'react';
import { getSettings, setSettings, resolveTheme, type Settings } from '~/lib/storage';
import { getLocalQuota } from '~/lib/quota';

const TARGET_LANGS = [
  { code: 'uk', name: 'Ukrainian' },
  { code: 'en', name: 'English' },
  { code: 'pl', name: 'Polish' },
  { code: 'de', name: 'German' },
  { code: 'ru', name: 'Russian' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
];

export function App() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [quota, setQuota] = useState(0);

  useEffect(() => {
    getSettings().then(setLocal);
    getLocalQuota().then(setQuota);
  }, []);

  const update = (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocal(next);
    setSettings(patch);
  };

  if (!settings) return null;
  const effectiveTheme = resolveTheme(settings.theme);
  const dark = effectiveTheme === 'dark';

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="w-[360px] p-4 bg-white dark:bg-zinc-900 dark:text-zinc-100 space-y-3">
        <h1 className="text-lg font-semibold">bcb-translater</h1>

        <label className="block">
          <span className="text-sm">Target language</span>
          <select
            className="w-full mt-1 border rounded p-1 dark:bg-zinc-800"
            value={settings.targetLang}
            onChange={(e) => update({ targetLang: e.target.value })}
          >
            {TARGET_LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm">Your API key (optional)</span>
          <input
            type="password"
            className="w-full mt-1 border rounded p-1 dark:bg-zinc-800"
            value={settings.userApiKey}
            onChange={(e) => update({ userApiKey: e.target.value })}
          />
          <select
            className="w-full mt-1 border rounded p-1 dark:bg-zinc-800"
            value={settings.provider}
            onChange={(e) =>
              update({ provider: e.target.value as Settings['provider'] })
            }
          >
            <option value="auto">Auto (Gemini → Groq)</option>
            <option value="gemini">Gemini</option>
            <option value="groq">Groq</option>
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.showInlineOnTweets}
            onChange={(e) => update({ showInlineOnTweets: e.target.checked })}
          />
          <span className="text-sm">Show inline button on tweets</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.enableHotkeys}
            onChange={(e) => update({ enableHotkeys: e.target.checked })}
          />
          <span className="text-sm">Enable hotkeys (Alt+T translate, Alt+S summary)</span>
        </label>

        <label className="block">
          <span className="text-sm">Tweet button color</span>
          <div className="flex gap-2 mt-1">
            <input
              type="color"
              className="h-8 w-12 border rounded dark:bg-zinc-800 cursor-pointer"
              value={settings.tweetButtonColor}
              onChange={(e) => update({ tweetButtonColor: e.target.value })}
            />
            <input
              type="text"
              className="flex-1 border rounded p-1 dark:bg-zinc-800 font-mono text-sm"
              value={settings.tweetButtonColor}
              onChange={(e) => update({ tweetButtonColor: e.target.value })}
            />
          </div>
        </label>

        {!settings.userApiKey && (
          <div className="text-sm text-zinc-500">
            Free quota today: {quota} / 50 used
          </div>
        )}

        <label className="block">
          <span className="text-sm">Theme</span>
          <select
            className="w-full mt-1 border rounded p-1 dark:bg-zinc-800"
            value={settings.theme}
            onChange={(e) => update({ theme: e.target.value as Settings['theme'] })}
          >
            <option value="auto">Auto (system)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>
    </div>
  );
}
