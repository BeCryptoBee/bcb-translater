import { detectLanguage } from '~/lib/lang-detect';
import { getSettings, onSettingsChange, type Settings } from '~/lib/storage';
import { TWEET_SELECTORS } from './selectors';

const FLAG = 'data-bcb-injected';
const BTN_CLASS = 'bcb-tweet-btn';
const BTN_STYLE =
  'margin-top:6px; padding:4px 8px; border:1px solid #ccc; border-radius:6px; background:transparent; cursor:pointer; font-size:13px;';
const SCAN_DEBOUNCE_MS = 200;

type OnClick = (text: string, anchor: HTMLElement) => void;

function cleanupAllButtons(): void {
  // Remove every injected button and clear flags so the next scan can re-inject.
  const btns = document.querySelectorAll<HTMLElement>(`.${BTN_CLASS}`);
  btns.forEach((b) => b.remove());
  const flagged = document.querySelectorAll<HTMLElement>(`[${FLAG}]`);
  flagged.forEach((el) => el.removeAttribute(FLAG));
}

async function runScan(onClick: OnClick): Promise<void> {
  let settings: Settings;
  try {
    settings = await getSettings();
  } catch {
    return;
  }
  if (!settings.showInlineOnTweets) return;

  const tweets = document.querySelectorAll<HTMLElement>(TWEET_SELECTORS.text);
  for (const t of tweets) {
    if (t.hasAttribute(FLAG)) continue;
    t.setAttribute(FLAG, '1');

    const text = t.innerText.trim();
    if (text.length < 5) continue;

    const lang = detectLanguage(text);
    if (lang === settings.targetLang) continue;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Translate / Summary';
    btn.className = BTN_CLASS;
    btn.style.cssText = BTN_STYLE;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(text, btn);
    });
    t.insertAdjacentElement('afterend', btn);
  }
}

export function startTweetInjector(onClick: OnClick): () => void {
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      void runScan(onClick);
    }, SCAN_DEBOUNCE_MS);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial pass (also debounced via the same mechanism so the first run
  // happens after a short delay, allowing the page to settle).
  schedule();

  // React to settings changes: when the toggle flips off, remove existing
  // buttons immediately. When it flips on, force a fresh scan now.
  let lastShow: boolean | null = null;
  void getSettings().then((s) => {
    lastShow = s.showInlineOnTweets;
  });
  const unsubscribeSettings = onSettingsChange((next) => {
    const prev = lastShow;
    lastShow = next.showInlineOnTweets;
    if (prev === next.showInlineOnTweets) return;
    if (!next.showInlineOnTweets) {
      cleanupAllButtons();
    } else {
      // Re-scan immediately on toggle-on so user sees buttons without waiting.
      cleanupAllButtons();
      void runScan(onClick);
    }
  });

  return () => {
    observer.disconnect();
    unsubscribeSettings();
    cleanupAllButtons();
  };
}
