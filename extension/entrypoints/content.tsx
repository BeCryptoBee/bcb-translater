import { ActionPopup } from '~/components/ActionPopup';
import { FloatingButton } from '~/components/FloatingButton';
import { mountShadow, type ShadowMount } from '~/lib/shadow-host';
import { watchSelection } from '~/lib/selection-watcher';
import { startTweetInjector } from '~/lib/twitter/injector';
import type { Mode } from '~/lib/messages';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let mount: ShadowMount | null = null;
    let pointerDownHandler: ((e: PointerEvent) => void) | null = null;
    let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    let pendingShow: number | null = null;

    // Floating button size (matches .bcb-floating in shadow.css).
    const FLOAT_W = 28;
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

    const showButton = (text: string, rect: DOMRect) => {
      closeMount();
      // Clamp X so the button never crosses the viewport's right edge
      // (which would otherwise add horizontal scroll on the host page).
      const rawX = rect.right + window.scrollX + 4;
      const maxX = window.scrollX + window.innerWidth - FLOAT_W - FLOAT_GUTTER;
      const x = Math.max(0, Math.min(rawX, maxX));
      const y = Math.max(0, rect.top + window.scrollY);
      const next = mountShadow(
        <FloatingButton onClick={() => showPopup(text, rect)} />,
        { x, y },
      );
      mount = next;
      attachDismiss(next);
    };

    const showPopup = (text: string, rect: DOMRect, defaultMode?: Mode) => {
      closeMount();
      const next: ShadowMount = mountShadow(
        <ActionPopup
          text={text}
          defaultMode={defaultMode}
          onClose={() => closeMount()}
        />,
        { x: rect.left + window.scrollX, y: rect.bottom + window.scrollY + 8 },
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
      startTweetInjector((text, anchor) => {
        const rect = anchor.getBoundingClientRect();
        showPopup(text, rect);
      });
    }
  },
});
