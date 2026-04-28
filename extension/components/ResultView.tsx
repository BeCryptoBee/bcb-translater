import { useState } from 'react';
import type { Mode, ProcessResponse } from '~/lib/messages';

interface Props {
  resp: ProcessResponse;
  currentMode: Mode;
  onSwitch: (m: Mode) => void;
}

export function ResultView({ resp, currentMode, onSwitch }: Props) {
  const [copied, setCopied] = useState(false);

  if (!resp.ok) {
    return (
      <div className="bcb-result">
        <div className="bcb-error">{resp.message}</div>
        <div className="bcb-toolbar">
          <button
            type="button"
            className="bcb-retry"
            onClick={() => onSwitch(currentMode)}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const otherMode: Mode = currentMode === 'translate' ? 'summarize' : 'translate';
  const switchLabel = otherMode === 'translate' ? 'Translate instead' : 'Summarize instead';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(resp.result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="bcb-result">
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>
        {resp.result}
      </pre>
      <div className="bcb-toolbar">
        <button type="button" className="bcb-switch" onClick={() => onSwitch(otherMode)}>
          {switchLabel}
        </button>
        <button type="button" className="bcb-copy" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
