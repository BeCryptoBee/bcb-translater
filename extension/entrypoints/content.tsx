import { ActionPopup } from '~/components/ActionPopup';
import { FloatingButton } from '~/components/FloatingButton';
import { mountShadow, type ShadowMount } from '~/lib/shadow-host';
import { watchSelection } from '~/lib/selection-watcher';
import { startTweetInjector } from '~/lib/twitter/injector';
import { getSettings, onSettingsChange } from '~/lib/storage';
import type { Mode } from '~/lib/messages';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let mount: ShadowMount | null = null;
    // Tagged so selectionchange-cleared can dismiss only the floating bar,
    // never the result popup (the user may want to keep reading the result
    // even after they cleared the selection).
    let mountKind: 'floating' | 'popup' | null = null;
    let pointerDownHandler: ((e: PointerEvent) => void) | null = null;
    let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    let pendingShow: number | null = null;

    // Track the last mouseup position to anchor the floating bar there.
    // For mouse-driven selections, this matches the user's eyes; for
    // keyboard-driven selections (Ctrl+A, Shift+Arrow), we fall back to
    // the end of the last visible line of the selection.
    const lastMouseup = { x: 0, y: 0, t: 0 };
    document.addEventListener(
      'mouseup',
      (e) => {
        lastMouseup.x = e.clientX;
        lastMouseup.y = e.clientY;
        lastMouseup.t = Date.now();
      },
      true,
    );

    // Approximate width of the two-button floating bar (.bcb-floating-bar).
    // Used to clamp X so the bar doesn't push past the viewport's right edge.
    const FLOAT_W = 160;
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
      if (!mount) return;
      mount.unmount();
      mount = null;
      mountKind = null;
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
    // Detach on hot-reload of the content script (defensive).
    window.addEventListener('beforeunload', () => unsubAccent(), { once: true });

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
        return { x: lastMouseup.x + 8, y: lastMouseup.y + 8 };
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
          onTranslate={() => showPopup(text, rect, 'translate')}
          onSummary={() => showPopup(text, rect, 'summarize')}
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
    ) => {
      closeMount();
      const pos =
        anchor instanceof DOMRect ? computePopupPosition(anchor) : anchor;
      const next: ShadowMount = mountShadow(
        <ActionPopup
          text={text}
          defaultMode={defaultMode}
          onClose={() => closeMount()}
        />,
        pos,
      );
      mount = next;
      mountKind = 'popup';
      attachDismiss(next);
    };

    watchSelection((sel) => {
      if (!sel) {
        // Selection went away (typed over, deleted, clicked elsewhere). Drop
        // any pending mount AND close the floating bar if it's the visible
        // mount. We do NOT close the result popup on selection clear — the
        // user may have read the result and just moved the cursor on.
        cancelPendingShow();
        if (mountKind === 'floating') closeMount();
        return;
      }
      // Debounce: only mount the button after the user has stopped extending
      // the selection for a moment. This single change kills the flicker
      // caused by selectionchange firing on every pixel of mouse drag.
      cancelPendingShow();
      pendingShow = window.setTimeout(() => {
        pendingShow = null;
        showButton(sel.text, sel.rect);
      }, SELECTION_DEBOUNCE_MS);
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as { type?: string; mode?: Mode; text?: string };
      if (m.type !== 'trigger-action') return;
      if (m.mode !== 'translate' && m.mode !== 'summarize') return;

      const sel = document.getSelection();
      const text = m.text ?? sel?.toString() ?? '';
      if (!text) return;

      // For context menu / hotkey invocations, ignore the selection rect
      // entirely and place the popup at the top-center of the current
      // viewport. Some sites clear the selection on right-click (so the rect
      // is gone), and even when it's there it can be off-screen if the user
      // scrolled — both cases used to drop the popup somewhere invisible.
      showPopup(text, viewportCenterPosition(), m.mode);
    });

    // X.com / twitter.com: inject inline "Translate / Summary" button
    // under foreign-language tweets. Hostname guard matches x.com, twitter.com
    // and any subdomain (e.g. mobile.x.com).
    if (/(?:^|\.)(?:x\.com|twitter\.com)$/.test(location.hostname)) {
      startTweetInjector((text, tweetTextEl, mode) => {
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
        showPopup(text, rect, mode);
      });
    }
  },
});
