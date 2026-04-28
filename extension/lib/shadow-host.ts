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
