import { ActionPopup } from '~/components/ActionPopup';
import { FloatingButton } from '~/components/FloatingButton';
import { mountShadow, type ShadowMount } from '~/lib/shadow-host';
import { watchSelection } from '~/lib/selection-watcher';
import type { Mode } from '~/lib/messages';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let mount: ShadowMount | null = null;
    let pointerDownHandler: ((e: PointerEvent) => void) | null = null;
    let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

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
      const next = mountShadow(
        <FloatingButton onClick={() => showPopup(text, rect)} />,
        { x: rect.right + window.scrollX + 4, y: rect.top + window.scrollY },
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
      showButton(sel.text, sel.rect);
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
  },
});
