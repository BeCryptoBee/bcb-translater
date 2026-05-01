import { ActionPopup } from '~/components/ActionPopup';
import { FloatingButton } from '~/components/FloatingButton';
import { mountShadow, type ShadowMount } from '~/lib/shadow-host';
import { watchSelection, getSelectionText } from '~/lib/selection-watcher';
import { startTweetInjector } from '~/lib/twitter/injector';
import { getSettings, onSettingsChange } from '~/lib/storage';
import type { Mode } from '~/lib/messages';
import {
  wrapTweetSegments,
  setActiveSegment,
  clearAllActiveSegments,
} from '~/lib/highlight/tweet-wrapper';
import {
  installHighlightStylesheet,
  installTweetSegmentStylesheet,
  setSelectionHighlight,
  clearSelectionHighlight,
} from '~/lib/highlight/range-highlighter';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // If chrome.scripting.executeScript re-injected this script into a tab
    // that already has a previous instance running (which happens after
    // every extension reload), tear down the old instance first. Without
    // this, both old and new addEventListener registrations stay alive
    // and we end up with TWO floating bars / TWO popups for one action.
    type Win = typeof window & { __bcb_translator_cleanup__?: () => void };
    const w = window as Win;
    if (typeof w.__bcb_translator_cleanup__ === 'function') {
      try {
        w.__bcb_translator_cleanup__();
      } catch {
        // Old instance's chrome.runtime is detached; some teardowns may
        // throw — ignore and continue with a clean slate.
      }
    }
    // Every addEventListener / addListener / observer in this script pushes
    // its undo here. The chain is invoked atomically by the cleanup hook on
    // the next re-injection.
    const cleanups: Array<() => void> = [];

    let mount: ShadowMount | null = null;
    // Tagged so selectionchange-cleared can dismiss only the floating bar,
    // never the result popup (the user may want to keep reading the result
    // even after they cleared the selection).
    let mountKind: 'floating' | 'popup' | null = null;
    // Where the popup was opened from. Drives Translation Highlight dispatch:
    //   - 'selection' → highlight saved Range via CSS Custom Highlight API
    //   - 'tweet'     → wrap tweetTextEl spans on first hover, toggle class
    //   - 'command'   → no source-side highlight (no anchor)
    let popupOrigin: 'selection' | 'tweet' | 'command' | null = null;
    // Race guard: hover events that arrive after closeMount must no-op.
    let popupAborted = false;
    let savedSelectionRange: Range | null = null;
    let popupTweetEl: HTMLElement | null = null;
    // Per-popup AbortController used to remove all event listeners we attach
    // to the popup's shadow host. Aborted in closeMount so the host (and the
    // closures it captured) becomes GC-eligible immediately.
    let popupListenerCtl: AbortController | null = null;
    let pointerDownHandler: ((e: PointerEvent) => void) | null = null;
    let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    let pendingShow: number | null = null;

    // Track the last mouseup position so the bar appears near the user's
    // eyes for mouse selections, and a "drag in progress" flag so we never
    // mount the bar while the user is still extending the selection — that
    // used to put the bar in the cursor's path and break the drag.
    const lastMouseup = { x: 0, y: 0, t: 0 };
    let dragInProgress = false;

    const mousedownHandler = (e: MouseEvent) => {
      if (e.button === 0) dragInProgress = true;
    };
    const mouseupHandler = (e: MouseEvent) => {
      lastMouseup.x = e.clientX;
      lastMouseup.y = e.clientY;
      lastMouseup.t = Date.now();
      if (!dragInProgress) return;
      dragInProgress = false;
      // Mouse-driven selection has just been finalised. Show the bar after a
      // tiny delay so the user's cursor naturally moves away from the
      // mouseup point first.
      cancelPendingShow();
      pendingShow = window.setTimeout(() => {
        pendingShow = null;
        const live = document.getSelection();
        if (!live || live.rangeCount === 0 || live.isCollapsed) return;
        const text = getSelectionText(live);
        if (text.trim().length < 3) return;
        const rect = live.getRangeAt(0).getBoundingClientRect();
        showButton(text, rect);
      }, 120);
    };
    document.addEventListener('mousedown', mousedownHandler, true);
    document.addEventListener('mouseup', mouseupHandler, true);
    cleanups.push(() => {
      document.removeEventListener('mousedown', mousedownHandler, true);
      document.removeEventListener('mouseup', mouseupHandler, true);
    });

    // Approximate width of the two-letter floating bar (.bcb-floating-bar).
    // Used to clamp X so the bar doesn't push past the viewport's right edge.
    const FLOAT_W = 64;
    const FLOAT_GUTTER = 8;
    // Time selection must be stable before we mount the button. This eliminates
    // the flicker that came from remounting on every selectionchange while the
    // user was still dragging to extend a selection.
    const SELECTION_DEBOUNCE_MS = 200;

    const cancelPendingShow = () => {
      if (pendingShow != null) {
        clearTimeout(pendingShow);
        pendingShow = null;
      }
    };

    const detachDismiss = () => {
      if (pointerDownHandler) {
        document.removeEventListener('pointerdown', pointerDownHandler, true);
        pointerDownHandler = null;
      }
      if (keydownHandler) {
        document.removeEventListener('keydown', keydownHandler, true);
        keydownHandler = null;
      }
    };

    const closeMount = () => {
      cancelPendingShow();
      // Mark aborted BEFORE unmounting so any in-flight hover dispatches
      // bail out instead of touching torn-down state.
      popupAborted = true;
      // Clear any active source-side highlights synchronously so they
      // don't outlive the popup that owned them.
      clearSelectionHighlight();
      if (popupTweetEl) clearAllActiveSegments(popupTweetEl);
      // Detach all listeners we attached to the popup's shadow host so the
      // host and its captured closures become GC-eligible immediately.
      popupListenerCtl?.abort();
      popupListenerCtl = null;
      if (!mount) return;
      mount.unmount();
      mount = null;
      mountKind = null;
      popupOrigin = null;
      savedSelectionRange = null;
      popupTweetEl = null;
      detachDismiss();
    };

    const attachDismiss = (current: ShadowMount) => {
      detachDismiss();
      pointerDownHandler = (e: PointerEvent) => {
        const target = e.target as Node | null;
        if (target && current.host.contains(target)) return;
        // Click could also be inside the shadow root via composedPath.
        const path = e.composedPath();
        if (path.includes(current.host)) return;
        closeMount();
      };
      keydownHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeMount();
      };
      document.addEventListener('pointerdown', pointerDownHandler, true);
      document.addEventListener('keydown', keydownHandler, true);
    };

    // The selection floating bar shares the user's chosen accent color with
    // the inline tweet button (single setting, used in two places). Cache
    // the latest value so showButton stays synchronous; refresh when the
    // user updates settings.
    let accentColor = '#9ca3af';
    void getSettings().then((s) => {
      accentColor = s.tweetButtonColor;
    });
    const unsubAccent = onSettingsChange((s) => {
      accentColor = s.tweetButtonColor;
    });
    cleanups.push(unsubAccent);

    // Decide where to anchor the floating bar (in viewport coordinates).
    // Priority:
    //   1. Recent mouseup (< 800ms ago) — user just released the mouse to
    //      finish a drag-select; anchor a touch down-right of that point.
    //   2. End of the last visible line of the selection — for keyboard
    //      selection (Ctrl+A, Shift+Arrow) this lands at the cursor.
    //   3. Bounding rect of the selection — last-resort fallback.
    const computeBarAnchor = (sel: { rect: DOMRect }): { x: number; y: number } => {
      const recent = Date.now() - lastMouseup.t < 800;
      if (recent) {
        // Sit a bit further from the cursor (down + right) so a small
        // post-release mouse jiggle doesn't drift onto the bar and break
        // selection extension.
        return { x: lastMouseup.x + 18, y: lastMouseup.y + 18 };
      }
      const live = document.getSelection();
      if (live && live.rangeCount > 0 && !live.isCollapsed) {
        const range = live.getRangeAt(0);
        const rects = range.getClientRects();
        const last = rects[rects.length - 1];
        if (last && last.width > 0) {
          return { x: last.right + 4, y: last.top };
        }
      }
      return { x: sel.rect.right + 4, y: sel.rect.top };
    };

    const showButton = (text: string, rect: DOMRect) => {
      closeMount();
      const anchor = computeBarAnchor({ rect });
      // Clamp X/Y so the bar stays within the viewport (no horizontal scroll,
      // no off-screen Y when a selection runs past the visible area).
      const maxX = window.scrollX + window.innerWidth - FLOAT_W - FLOAT_GUTTER;
      const maxY = window.scrollY + window.innerHeight - 40;
      const x = Math.max(0, Math.min(anchor.x + window.scrollX, maxX));
      const y = Math.max(0, Math.min(anchor.y + window.scrollY, maxY));
      const next = mountShadow(
        <FloatingButton
          onTranslate={() =>
            showPopup(text, rect, 'translate', {
              smartDirection: true,
              origin: 'selection',
            })
          }
          onSummary={() => showPopup(text, rect, 'summarize', { origin: 'selection' })}
          color={accentColor}
        />,
        { x, y },
      );
      mount = next;
      mountKind = 'floating';
      attachDismiss(next);
    };

    // Popup default width — must match .bcb-popup width in shadow.css.
    const POPUP_W = 460;
    const POPUP_MARGIN = 12;

    const computePopupPosition = (rect: DOMRect): { x: number; y: number } => {
      // Prefer placing the popup to the RIGHT of the source rect — that way
      // the user sees both the original text and the translation side by side.
      // Fall back to BELOW the rect when there's not enough room on the right.
      const spaceRight = window.innerWidth - rect.right;
      if (spaceRight >= POPUP_W + POPUP_MARGIN) {
        return {
          x: rect.right + window.scrollX + POPUP_MARGIN,
          y: rect.top + window.scrollY,
        };
      }
      // Below the source. Clamp X so the popup doesn't run off the right edge.
      const maxX = window.scrollX + window.innerWidth - POPUP_W - 8;
      const x = Math.max(8, Math.min(rect.left + window.scrollX, maxX));
      return { x, y: rect.bottom + window.scrollY + 8 };
    };

    // Always-visible position: top-center of the current viewport. Used when
    // we're invoked via context menu / hotkey, where we have no reliable
    // selection rect (some sites clear the selection on right-click) and
    // computing from a wrong rect can put the popup off-screen.
    const viewportCenterPosition = (): { x: number; y: number } => {
      const x = window.scrollX + Math.max(8, (window.innerWidth - POPUP_W) / 2);
      const y = window.scrollY + 60;
      return { x, y };
    };

    const showPopup = (
      text: string,
      anchor: DOMRect | { x: number; y: number },
      defaultMode?: Mode,
      opts?: {
        smartDirection?: boolean;
        origin?: 'selection' | 'tweet' | 'command';
        tweetEl?: HTMLElement;
      },
    ) => {
      closeMount();
      // Capture range BEFORE mounting; mounting steals focus and may
      // collapse the live selection.
      popupAborted = false;
      popupOrigin = opts?.origin ?? null;
      if (popupOrigin === 'selection') {
        const live = document.getSelection();
        if (live && live.rangeCount > 0 && !live.isCollapsed) {
          savedSelectionRange = live.getRangeAt(0).cloneRange();
          // Drop the visible browser selection so the native blue highlight
          // doesn't sit on top of (and obscure) our yellow CSS Custom
          // Highlight when the user hovers translated sentences. The Range
          // is preserved in `savedSelectionRange` for the highlighter; the
          // user can re-select the same text later if they need to.
          live.removeAllRanges();
        }
      } else if (popupOrigin === 'tweet') {
        popupTweetEl = opts?.tweetEl ?? null;
      }
      const pos =
        anchor instanceof DOMRect ? computePopupPosition(anchor) : anchor;
      const next: ShadowMount = mountShadow(
        <ActionPopup
          text={text}
          defaultMode={defaultMode}
          smartDirection={opts?.smartDirection}
          onClose={() => closeMount()}
        />,
        pos,
      );
      mount = next;
      mountKind = 'popup';
      attachDismiss(next);

      // -- Translation Highlight wiring --
      // Page-document stylesheets must live OUTSIDE the popup's shadow root.
      // CSS Custom Highlight API is document-scoped; the tweet's --active
      // class lives in the page DOM. Both helpers are idempotent.
      if (popupOrigin === 'selection') installHighlightStylesheet(accentColor);
      if (popupOrigin === 'tweet') installTweetSegmentStylesheet(accentColor);

      // Per-popup state for the highlight handlers below.
      let segmentsForHighlight: Array<{ src: string; tgt: string }> | null = null;
      let tweetWrapped = false;

      const onSegmentsReady = (e: Event) => {
        const evt = e as CustomEvent<{
          segments: Array<{ src: string; tgt: string }>;
        }>;
        segmentsForHighlight = evt.detail.segments;
      };

      const onSegmentHover = (e: Event) => {
        if (popupAborted) return;
        const evt = e as CustomEvent<{
          index: number;
          src: string;
          action: 'enter' | 'leave';
        }>;
        const { index, src, action } = evt.detail;

        if (popupOrigin === 'selection' && savedSelectionRange) {
          if (action === 'enter') setSelectionHighlight(savedSelectionRange, src);
          else clearSelectionHighlight();
          return;
        }

        if (popupOrigin === 'tweet' && popupTweetEl && segmentsForHighlight) {
          if (!tweetWrapped) {
            wrapTweetSegments(popupTweetEl, segmentsForHighlight);
            tweetWrapped = true;
          }
          setActiveSegment(popupTweetEl, index, action === 'enter');
          return;
        }
        // popupOrigin === 'command': no-op (no anchor to highlight)
      };

      popupListenerCtl = new AbortController();
      const sig = popupListenerCtl.signal;
      next.host.addEventListener('bcb-segments-ready', onSegmentsReady, { signal: sig });
      next.host.addEventListener('bcb-segment-hover', onSegmentHover, { signal: sig });
    };

    const unwatchSelection = watchSelection((sel) => {
      if (!sel) {
        // Selection went away (typed over, deleted, clicked elsewhere). Drop
        // any pending mount AND close the floating bar if it's the visible
        // mount. We do NOT close the result popup on selection clear — the
        // user may have read the result and just moved the cursor on.
        cancelPendingShow();
        if (mountKind === 'floating') closeMount();
        return;
      }
      // While the user is actively dragging to extend the selection, never
      // mount the bar. mouseup will trigger it once the drag is finished.
      if (dragInProgress) {
        cancelPendingShow();
        return;
      }
      // Keyboard-driven selection (Ctrl+A, Shift+Arrow): no mouseup will
      // fire, so debounce the selectionchange stream and mount when stable.
      cancelPendingShow();
      pendingShow = window.setTimeout(() => {
        pendingShow = null;
        showButton(sel.text, sel.rect);
      }, SELECTION_DEBOUNCE_MS);
    });
    cleanups.push(unwatchSelection);

    const onMessageHandler = (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as { type?: string; mode?: Mode; text?: string };
      if (m.type !== 'trigger-action') return;
      if (m.mode !== 'translate' && m.mode !== 'summarize') return;

      const sel = document.getSelection();
      const text = m.text ?? (sel ? getSelectionText(sel) : '');
      if (!text) return;

      // For context menu / hotkey invocations, ignore the selection rect
      // entirely and place the popup at the top-center of the current
      // viewport. Some sites clear the selection on right-click (so the rect
      // is gone), and even when it's there it can be off-screen if the user
      // scrolled — both cases used to drop the popup somewhere invisible.
      showPopup(text, viewportCenterPosition(), m.mode, { origin: 'command' });
    };
    chrome.runtime.onMessage.addListener(onMessageHandler);
    cleanups.push(() => {
      try {
        chrome.runtime.onMessage.removeListener(onMessageHandler);
      } catch {
        // chrome.runtime may already be invalidated on a detached old instance.
      }
    });

    // X.com / twitter.com: inject inline "Translate / Summary" button
    // under foreign-language tweets. Hostname guard matches x.com, twitter.com
    // and any subdomain (e.g. mobile.x.com).
    if (/(?:^|\.)(?:x\.com|twitter\.com)$/.test(location.hostname)) {
      const unwatchTweets = startTweetInjector((text, tweetTextEl, mode) => {
        // Mix two rects: take horizontal extent from the whole article so the
        // popup lands BESIDE the tweet (not inside it), but take the vertical
        // start from the tweet text itself so the popup aligns with the
        // beginning of the content rather than the username header above it.
        const article =
          (tweetTextEl.closest('article[role="article"]') as HTMLElement | null) ??
          (tweetTextEl.closest('article') as HTMLElement | null);
        const aRect = (article ?? tweetTextEl).getBoundingClientRect();
        const tRect = tweetTextEl.getBoundingClientRect();
        const rect = new DOMRect(aRect.left, tRect.top, aRect.width, aRect.height);
        showPopup(text, rect, mode, { origin: 'tweet', tweetEl: tweetTextEl });
      });
      cleanups.push(unwatchTweets);
    }

    // Always close any visible mount last during cleanup so listeners don't
    // outlive their owning shadow root.
    cleanups.push(() => closeMount());

    // Register the cleanup hook so the NEXT instance (after another
    // chrome.scripting.executeScript) can tear us down cleanly.
    w.__bcb_translator_cleanup__ = () => {
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          /* swallow per-step errors */
        }
      }
    };
  },
});
