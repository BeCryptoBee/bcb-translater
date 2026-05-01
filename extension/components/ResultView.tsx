import { Fragment, useEffect, useRef, useState } from 'react';
import type { Mode, ProcessResponse } from '~/lib/messages';

interface Props {
  resp: ProcessResponse;
  currentMode: Mode;
  onSwitch: (m: Mode) => void;
}

function dispatchSegmentHover(
  el: EventTarget,
  index: number,
  src: string,
  action: 'enter' | 'leave',
): void {
  if (!(el instanceof Element)) return;
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    root.host.dispatchEvent(
      new CustomEvent('bcb-segment-hover', {
        bubbles: true,
        composed: true,
        detail: { index, src, action },
      }),
    );
  }
}

export function ResultView({ resp, currentMode, onSwitch }: Props) {
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const segments = resp.ok ? resp.segments : undefined;
  const separators = resp.ok ? resp.separators : undefined;

  // Once segments are available, broadcast them to the content-script side
  // (via the popup's shadow host) so it can wrap source-side spans on first
  // hover and dispatch highlights.
  useEffect(() => {
    if (!segments) return;
    const root = rootRef.current?.getRootNode();
    if (root instanceof ShadowRoot) {
      root.host.dispatchEvent(
        new CustomEvent('bcb-segments-ready', {
          bubbles: true,
          composed: true,
          detail: { segments },
        }),
      );
    }
  }, [segments]);

  if (!resp.ok) {
    return (
      <div className="bcb-result" ref={rootRef}>
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

  const segmentedReady = segments && separators && segments.length === separators.length;

  return (
    <div className="bcb-result" ref={rootRef}>
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>
        {segmentedReady
          ? segments!.map((seg, i) => (
              <Fragment key={i}>
                {separators![i]}
                <span
                  className="bcb-tgt-seg"
                  data-segment-index={i}
                  onMouseEnter={(e) =>
                    dispatchSegmentHover(e.currentTarget, i, seg.src, 'enter')
                  }
                  onMouseLeave={(e) =>
                    dispatchSegmentHover(e.currentTarget, i, seg.src, 'leave')
                  }
                >
                  {seg.tgt}
                </span>
              </Fragment>
            ))
          : resp.result}
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
