import { detectLanguage } from '~/lib/lang-detect';
import { getSettings, onSettingsChange, type Settings } from '~/lib/storage';
import type { Mode } from '~/lib/messages';
import { unwrapSegmentSpans } from '~/lib/highlight/tweet-wrapper';
import { TWEET_SELECTORS } from './selectors';

const FLAG = 'data-bcb-injected';
const BTN_CLASS = 'bcb-tweet-btn';
const WRAP_CLASS = 'bcb-tweet-btn-wrap';
const SCAN_DEBOUNCE_MS = 200;

function buildBtnStyle(color: string): string {
  // Single pill style; multiple pills sit side by side inside a flex wrapper.
  return [
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

function buildWrapStyle(): string {
  // Flex row that hugs its content so the two pills don't stretch across
  // the tweet width inside X.com's flex-column layout.
  return [
    'display:flex',
    'gap:6px',
    'width:fit-content',
    'max-width:fit-content',
    'margin:4px 0 6px 0',
  ].join(';');
}

type OnClick = (text: string, tweetTextEl: HTMLElement, mode: Mode) => void;

function cleanupAllButtons(): void {
  // Remove every injected wrapper (which contains the two pill buttons) and
  // clear flags so the next scan can re-inject.
  const wraps = document.querySelectorAll<HTMLElement>(`.${WRAP_CLASS}`);
  wraps.forEach((w) => w.remove());
  const flagged = document.querySelectorAll<HTMLElement>(`[${FLAG}]`);
  flagged.forEach((el) => {
    el.removeAttribute(FLAG);
    // Also unwrap any leftover Translation Highlight segment spans inside
    // this tweet's text container so the next hover can wrap cleanly.
    unwrapSegmentSpans(el);
  });
}

// Routes where the tweets we'd see are tiny previews of someone else's
// activity (notifications, DM previews) rather than primary content the
// user is actively reading. Skip injection there entirely — selection-
// based translation still works, just no inline button.
const SKIP_PATHS = /^\/(?:notifications|messages)(?:\/|$)/;

async function runScan(onClick: OnClick): Promise<void> {
  let settings: Settings;
  try {
    settings = await getSettings();
  } catch {
    return;
  }
  if (!settings.showInlineOnTweets) return;
  if (SKIP_PATHS.test(location.pathname)) {
    // Defensive: if the user just navigated INTO a skip route, prune any
    // buttons that lingered on now-hidden but still-mounted nodes.
    cleanupAllButtons();
    return;
  }

  const tweets = document.querySelectorAll<HTMLElement>(TWEET_SELECTORS.text);
  for (const t of tweets) {
    if (t.hasAttribute(FLAG)) continue;
    t.setAttribute(FLAG, '1');

    // Send the raw innerText with line breaks intact. Earlier versions
    // collapsed isolated single "\n" to a space because Twitter's
    // verified-badge / mention rendering used to insert spurious newlines
    // — but downstream we now pre-split the text on "\n" and send each
    // line as its own translation unit, so preserving real list/quote
    // boundaries is FAR more important than smoothing out the occasional
    // artifact line. The model still translates each line cleanly even
    // if it contains a stray prefix/suffix from rendering.
    const text = t.innerText.trim();
    if (text.length < 5) continue;

    const lang = detectLanguage(text);
    if (lang === settings.targetLang) continue;

    const wrap = document.createElement('span');
    wrap.className = WRAP_CLASS;
    wrap.style.cssText = buildWrapStyle();

    const makeBtn = (label: string, mode: Mode): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = BTN_CLASS;
      b.style.cssText = buildBtnStyle(settings.tweetButtonColor);
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(text, t, mode);
      });
      return b;
    };

    wrap.appendChild(makeBtn('Translate', 'translate'));
    wrap.appendChild(makeBtn('Summary', 'summarize'));
    t.insertAdjacentElement('beforebegin', wrap);
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
