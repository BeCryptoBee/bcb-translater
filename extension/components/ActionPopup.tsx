import { useEffect, useState } from 'react';
import { ResultView } from './ResultView';
import type { Mode, ProcessRequest, ProcessResponse } from '~/lib/messages';
import { getSettings } from '~/lib/storage';

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

  const run = async (mode: Mode) => {
    setState({ phase: 'loading', mode });
    const settings = await getSettings();
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
  // Wrapped in useEffect to avoid running on every render.
  useEffect(() => {
    if (defaultMode) void run(defaultMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bcb-popup">
      <button
        type="button"
        className="bcb-close"
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>
      {state.phase === 'choose' && (
        <div className="bcb-actions">
          <button type="button" onClick={() => run('translate')}>
            🌐 Translate
          </button>
          <button type="button" onClick={() => run('summarize')}>
            ✂️ Summary
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
  );
}
