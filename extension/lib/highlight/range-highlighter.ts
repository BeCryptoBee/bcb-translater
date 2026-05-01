import { buildProjection, locateInProjection } from './projection';
import { normalizeForMatch } from '../segments-validate';

const HL_NAME = 'bcb-translation-hl';
const ACCENT_VAR = '--bcb-hl-accent';
const STYLE_ID = 'bcb-hl-stylesheet';
const TWEET_STYLE_ID = 'bcb-tweet-seg-style';

// CSS Custom Highlight API typing — the lib.dom.d.ts in our toolchain may
// not declare it on all setups. We use loose declarations to avoid
// peppering the call sites with `@ts-expect-error`.
interface HighlightApi {
  has(name: string): boolean;
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  delete(name: string): void;
}
interface CssWithHighlights {
  highlights?: HighlightApi;
}
declare const Highlight: { new (range: Range): unknown } | undefined;

function getHighlights(): HighlightApi | null {
  if (typeof CSS === 'undefined') return null;
  const c = CSS as unknown as CssWithHighlights;
  return c.highlights ?? null;
}

/**
 * Install the page-document `::highlight()` rule for the selection-side
 * source highlight. Called once per popup with selection origin (idempotent).
 * Updates the accent CSS variable each call so user setting changes take
 * effect on the next popup.
 */
export function installHighlightStylesheet(accentColor: string): void {
  document.documentElement.style.setProperty(ACCENT_VAR, accentColor);

  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ::highlight(${HL_NAME}) {
      background-color: color-mix(in srgb, var(${ACCENT_VAR}, #facc15) 35%, transparent);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Install the page-document rule for the inline-tweet source highlight
 * (active class on wrapped spans). Lives here for cohesion — both helpers
 * inject styles into `document.head`, not into the popup's shadow root.
 */
export function installTweetSegmentStylesheet(accentColor: string): void {
  // Always refresh the accent var even if the style element is already there.
  document.documentElement.style.setProperty(ACCENT_VAR, accentColor);

  if (document.getElementById(TWEET_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TWEET_STYLE_ID;
  style.textContent = `
    .bcb-src-seg--active {
      background-color: color-mix(in srgb, var(${ACCENT_VAR}, #facc15) 35%, transparent);
      border-radius: 2px;
    }
  `;
  document.head.appendChild(style);
}

/**
 * For the arbitrary-selection path, find `segmentSrc` inside the saved Range
 * and register it with the CSS Custom Highlight registry. No DOM mutation —
 * the browser paints the highlight on top of existing nodes.
 */
export function setSelectionHighlight(savedRange: Range, segmentSrc: string): void {
  const reg = getHighlights();
  if (!reg || typeof Highlight === 'undefined') return;
  try {
    const proj = buildProjection(savedRange, normalizeForMatch);
    const found = locateInProjection(proj, segmentSrc, 0);
    if (!found || found.covers.length === 0) {
      clearSelectionHighlight();
      return;
    }
    const first = found.covers[0]!;
    const last = found.covers[found.covers.length - 1]!;
    const ownerDoc = savedRange.startContainer.ownerDocument ?? document;
    const range = ownerDoc.createRange();
    range.setStart(first.textNode, first.startOffset);
    range.setEnd(last.textNode, last.endOffset);
    reg.set(HL_NAME, new Highlight(range));
  } catch {
    clearSelectionHighlight();
  }
}

export function clearSelectionHighlight(): void {
  const reg = getHighlights();
  if (!reg) return;
  try {
    reg.delete(HL_NAME);
  } catch {
    /* noop */
  }
}
