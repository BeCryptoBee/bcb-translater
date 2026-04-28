import { useEffect, useState, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ResultView } from './ResultView';
import type { Mode, ProcessRequest, ProcessResponse } from '~/lib/messages';
import { getSettings } from '~/lib/storage';
import { detectLanguage } from '~/lib/lang-detect';
import { normalizeLang } from '~/lib/prompts';

type State =
  | { phase: 'choose' }
  | { phase: 'loading'; mode: Mode }
  | { phase: 'result'; mode: Mode; resp: ProcessResponse };

interface Props {
  text: string;
  onClose: () => void;
  defaultMode?: Mode;
}

export function ActionPopup({ text, onClose, defaultMode }: Props) {
  const [state, setState] = useState<State>(
    defaultMode ? { phase: 'loading', mode: defaultMode } : { phase: 'choose' },
  );
  const [targetLang, setTargetLang] = useState<string>('uk');
  const headerRef = useRef<HTMLDivElement>(null);

  // Detect source language once from the text we were given. franc-min is
  // synchronous and fast, so we keep it inline rather than in an effect.
  const sourceLangCode = detectLanguage(text);
  const sourceLangName =
    sourceLangCode === 'und' ? '?' : normalizeLang(sourceLangCode);
  const targetLangName = normalizeLang(targetLang);

  let headerLabel = '';
  if (state.phase !== 'choose') {
    headerLabel =
      state.mode === 'translate'
        ? `Translate · ${sourceLangName} → ${targetLangName}`
        : `Summary · ${targetLangName}`;
  }

  const run = async (mode: Mode) => {
    setState({ phase: 'loading', mode });
    const settings = await getSettings();
    setTargetLang(settings.targetLang);
    const request: ProcessRequest = {
      type: 'process',
      mode,
      text,
      targetLang: settings.targetLang,
    };
    const resp: ProcessResponse = await chrome.runtime.sendMessage(request);
    setState({ phase: 'result', mode, resp });
  };

  // Auto-run once on mount when a defaultMode was supplied (e.g. context menu / hotkey).
  useEffect(() => {
    if (defaultMode) void run(defaultMode);
    else void getSettings().then((s) => setTargetLang(s.targetLang));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag the popup by its header. We move the Shadow-DOM host element so the
  // popup floats freely; this does NOT affect document layout.
  const onHeaderPointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    // Don't start a drag if the user pressed the close button
    if ((ev.target as HTMLElement).closest('.bcb-close')) return;
    const root = headerRef.current?.getRootNode();
    if (!(root instanceof ShadowRoot)) return;
    const host = root.host as HTMLElement;

    const startX = ev.clientX;
    const startY = ev.clientY;
    const rect = host.getBoundingClientRect();
    // Convert to page coordinates (host uses position:absolute relative to body).
    const startLeft = rect.left + window.scrollX;
    const startTop = rect.top + window.scrollY;

    ev.preventDefault();

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      host.style.left = `${startLeft + dx}px`;
      host.style.top = `${startTop + dy}px`;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return (
    <div className="bcb-popup">
      <div
        ref={headerRef}
        className="bcb-header"
        onPointerDown={onHeaderPointerDown}
      >
        <span className="bcb-drag-grip" aria-hidden="true">⋮⋮</span>
        <span className="bcb-header-label">{headerLabel}</span>
        <button
          type="button"
          className="bcb-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="bcb-body">
        {state.phase === 'choose' && (
          <div className="bcb-actions">
            <button type="button" onClick={() => run('translate')}>
              Translate
            </button>
            <button type="button" onClick={() => run('summarize')}>
              Summary
            </button>
          </div>
        )}
        {state.phase === 'loading' && <div className="bcb-loading">Working…</div>}
        {state.phase === 'result' && (
          <ResultView
            resp={state.resp}
            currentMode={state.mode}
            onSwitch={(m) => void run(m)}
          />
        )}
      </div>
    </div>
  );
}
