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
  smartDirection?: boolean;
}

export function ActionPopup({ text, onClose, defaultMode, smartDirection }: Props) {
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
    let lang = 'uk';
    try {
      const settings = await getSettings();
      lang = settings.targetLang;
      setTargetLang(lang);
    } catch {
      // chrome.storage may be unreachable on a stale tab whose extension
      // context was invalidated. Fall through with the 'uk' default.
    }
    const request: ProcessRequest = {
      type: 'process',
      mode,
      text,
      targetLang: lang,
      // Smart-direction is only meaningful for Translate. If the user
      // opened the popup with T (smart) and switches to Summarize, the
      // flag drops naturally.
      ...(smartDirection && mode === 'translate' ? { smartDirection: true } : {}),
    };
    let resp: ProcessResponse;
    try {
      resp = await chrome.runtime.sendMessage(request);
    } catch (e) {
      // Common failure modes after the user reloaded the extension while
      // this page was already open — content script's chrome.runtime is
      // detached, so no message can reach the new background.
      const msg = String((e as Error)?.message ?? '');
      const detached =
        msg.includes('Extension context invalidated') ||
        msg.includes('Could not establish connection') ||
        msg.includes('Receiving end does not exist');
      resp = detached
        ? {
            ok: false,
            code: 'unknown',
            message: 'Extension was reloaded — please refresh this page (F5) and try again.',
          }
        : {
            ok: false,
            code: 'unknown',
            message: msg ? `Connection failed: ${msg}` : 'Connection failed.',
          };
    }
    setState({ phase: 'result', mode, resp });
  };

  // Auto-run once on mount when a defaultMode was supplied (e.g. context menu / hotkey).
  useEffect(() => {
    if (defaultMode) void run(defaultMode);
    else
      void getSettings()
        .then((s) => setTargetLang(s.targetLang))
        .catch(() => {
          /* stale tab; keep the default */
        });
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
