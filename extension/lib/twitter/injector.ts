import { detectLanguage } from '~/lib/lang-detect';
import { getSettings, onSettingsChange, type Settings } from '~/lib/storage';
import { TWEET_SELECTORS } from './selectors';

const FLAG = 'data-bcb-injected';
const BTN_CLASS = 'bcb-tweet-btn';
const SCAN_DEBOUNCE_MS = 200;

function buildBtnStyle(color: string): string {
  // X.com tweet bodies sit inside a flex-column whose children take 100% width
  // by default, so display:inline-block is not enough — the button still
  // stretches. Force its size to its content with width:fit-content, plus
  // display:block so it sits on its own line above the tweet text.
  return [
    'display:block',
    'width:fit-content',
    'max-width:fit-content',
    'margin:4px 0 6px 0',
    'padding:2px 10px',
    'border:1px solid currentColor',
    'border-radius:9999px',
    'background:transparent',
    'cursor:pointer',
    'font-size:12px',
    'line-height:18px',
    'opacity:0.85',
    `color:${color}`,
  ].join(';');
}

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
    btn.style.cssText = buildBtnStyle(settings.tweetButtonColor);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(text, btn);
    });
    t.insertAdjacentElement('beforebegin', btn);
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

  // React to settings changes that affect the inline button: visibility
  // toggle, target language (language detection re-evaluation) and color.
  // Any of these flip → remove existing buttons; if visibility is on, rescan.
  type Snap = { show: boolean; color: string; targetLang: string };
  let lastSnap: Snap | null = null;
  void getSettings().then((s) => {
    lastSnap = {
      show: s.showInlineOnTweets,
      color: s.tweetButtonColor,
      targetLang: s.targetLang,
    };
  });
  const unsubscribeSettings = onSettingsChange((next) => {
    const snap: Snap = {
      show: next.showInlineOnTweets,
      color: next.tweetButtonColor,
      targetLang: next.targetLang,
    };
    const prev = lastSnap;
    lastSnap = snap;
    if (!prev) return;
    if (
      prev.show === snap.show &&
      prev.color === snap.color &&
      prev.targetLang === snap.targetLang
    ) {
      return;
    }
    cleanupAllButtons();
    if (snap.show) void runScan(onClick);
  });

  return () => {
    observer.disconnect();
    unsubscribeSettings();
    cleanupAllButtons();
  };
}
