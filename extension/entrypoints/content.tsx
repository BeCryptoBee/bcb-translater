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
    let pointerDownHandler: ((e: PointerEvent) => void) | null = null;
    let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    let pendingShow: number | null = null;

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

    const showButton = (text: string, rect: DOMRect) => {
      closeMount();
      // Clamp X so the bar never crosses the viewport's right edge
      // (which would otherwise add horizontal scroll on the host page).
      const rawX = rect.right + window.scrollX + 4;
      const maxX = window.scrollX + window.innerWidth - FLOAT_W - FLOAT_GUTTER;
      const x = Math.max(0, Math.min(rawX, maxX));
      const y = Math.max(0, rect.top + window.scrollY);
      const next = mountShadow(
        <FloatingButton
          onTranslate={() => showPopup(text, rect, 'translate')}
          onSummary={() => showPopup(text, rect, 'summarize')}
          color={accentColor}
        />,
        { x, y },
      );
      mount = next;
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

    const showPopup = (text: string, rect: DOMRect, defaultMode?: Mode) => {
      closeMount();
      const next: ShadowMount = mountShadow(
        <ActionPopup
          text={text}
          defaultMode={defaultMode}
          onClose={() => closeMount()}
        />,
        computePopupPosition(rect),
      );
      mount = next;
      attachDismiss(next);
    };

    watchSelection((sel) => {
      if (!sel) return; // do not auto-clear: user may be moving cursor
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

      // showPopup adds scrollX/scrollY, so this rect must be in viewport coords.
      const viewportRect =
        sel && sel.rangeCount > 0 && !sel.isCollapsed
          ? sel.getRangeAt(0).getBoundingClientRect()
          : new DOMRect(window.innerWidth / 2 - 100, window.innerHeight / 2, 200, 30);

      showPopup(text, viewportRect, m.mode);
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
