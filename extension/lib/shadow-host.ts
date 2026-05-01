import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import shadowCss from '~/styles/shadow.css?inline';
import { getSettings, resolveTheme } from '~/lib/storage';

export interface ShadowMount {
  host: HTMLElement;
  root: Root;
  unmount(): void;
}

export function mountShadow(component: ReactNode, position: { x: number; y: number }): ShadowMount {
  const host = document.createElement('div');
  host.style.cssText = `position:absolute; left:${position.x}px; top:${position.y}px; z-index:2147483647;`;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = shadowCss;
  shadow.appendChild(styleEl);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  root.render(component);

  // Block pointer/mouse/click events that originate INSIDE our shadow from
  // bubbling up to host-page handlers. Without this, host pages with
  // outer-click dismiss (e.g. X.com reply compose modal) eat the click on
  // our floating bar before our React onClick fires, and the bar appears
  // dead. Listeners are on the host element, AFTER the events have already
  // crossed the shadow boundary, so our internal React onClicks still see
  // them. We do NOT block keyboard, focus, scroll — only the pointer chain.
  const blockOutward = (e: Event) => e.stopPropagation();
  host.addEventListener('pointerdown', blockOutward);
  host.addEventListener('mousedown', blockOutward);
  host.addEventListener('mouseup', blockOutward);
  host.addEventListener('click', blockOutward);
  host.addEventListener('touchstart', blockOutward);

  // Best-effort theme application: resolve "auto" against the system's
  // prefers-color-scheme. Failures (e.g. chrome.storage not ready) keep light.
  void getSettings()
    .then((s) => {
      host.dataset.theme = resolveTheme(s.theme);
    })
    .catch(() => {
      host.dataset.theme = 'light';
    });

  return {
    host,
    root,
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}
