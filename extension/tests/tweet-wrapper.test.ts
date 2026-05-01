import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';
import {
  wrapTweetSegments,
  unwrapSegmentSpans,
  setActiveSegment,
  clearAllActiveSegments,
} from '~/lib/highlight/tweet-wrapper';

let win: Window;

beforeEach(() => {
  win = new Window();
  vi.stubGlobal('document', win.document);
  vi.stubGlobal('Node', win.Node);
  vi.stubGlobal('NodeFilter', win.NodeFilter);
  vi.stubGlobal('Range', win.Range);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(html: string): HTMLElement {
  const root = win.document.createElement('div') as unknown as HTMLElement;
  (root as unknown as { innerHTML: string }).innerHTML = html;
  return root;
}

describe('wrapTweetSegments', () => {
  it('wraps two simple sentences in a flat text node', () => {
    const root = setup('Hello world. How are you?');
    wrapTweetSegments(root, [
      { src: 'Hello world.', tgt: '...' },
      { src: 'How are you?', tgt: '...' },
    ]);
    const spans = root.querySelectorAll('.bcb-src-seg');
    expect(spans.length).toBe(2);
    expect(spans[0]?.getAttribute('data-segment-index')).toBe('0');
    expect(spans[1]?.getAttribute('data-segment-index')).toBe('1');
  });

  it('handles segment crossing inline element', () => {
    const root = setup('Hi <a>@user</a>, welcome. End.');
    wrapTweetSegments(root, [
      { src: 'Hi @user, welcome.', tgt: '...' },
      { src: 'End.', tgt: '...' },
    ]);
    const segIdx0 = root.querySelectorAll('[data-segment-index="0"]');
    expect(segIdx0.length).toBeGreaterThan(1);
  });

  it('repeated identical src on multiple segments wraps each occurrence (no double-wrap)', () => {
    const root = setup('Yes. No. Yes.');
    wrapTweetSegments(root, [
      { src: 'Yes.', tgt: 'Так.' },
      { src: 'No.', tgt: 'Ні.' },
      { src: 'Yes.', tgt: 'Так.' },
    ]);
    // Each segment index must wrap exactly one span (the right occurrence).
    expect(root.querySelectorAll('[data-segment-index="0"]').length).toBe(1);
    expect(root.querySelectorAll('[data-segment-index="1"]').length).toBe(1);
    expect(root.querySelectorAll('[data-segment-index="2"]').length).toBe(1);
    // textContent stays intact (no duplicated wrapping mangling).
    expect(root.textContent).toBe('Yes. No. Yes.');
  });

  it('unwrapSegmentSpans restores original text content', () => {
    const root = setup('Hi there.');
    const before = root.textContent;
    wrapTweetSegments(root, [{ src: 'Hi there.', tgt: '...' }]);
    unwrapSegmentSpans(root);
    expect(root.textContent).toBe(before);
    expect(root.querySelectorAll('.bcb-src-seg').length).toBe(0);
  });
});

describe('setActiveSegment / clearAllActiveSegments', () => {
  it('toggles class on all spans of given index', () => {
    const root = setup('Hi <a>@user</a>, welcome.');
    wrapTweetSegments(root, [{ src: 'Hi @user, welcome.', tgt: '...' }]);
    setActiveSegment(root, 0, true);
    expect(root.querySelectorAll('.bcb-src-seg--active').length).toBeGreaterThan(0);
    setActiveSegment(root, 0, false);
    expect(root.querySelectorAll('.bcb-src-seg--active').length).toBe(0);
  });

  it('clearAllActiveSegments removes the active class from every wrapped span', () => {
    const root = setup('A. B. C.');
    wrapTweetSegments(root, [
      { src: 'A.', tgt: '...' },
      { src: 'B.', tgt: '...' },
      { src: 'C.', tgt: '...' },
    ]);
    setActiveSegment(root, 0, true);
    setActiveSegment(root, 1, true);
    expect(root.querySelectorAll('.bcb-src-seg--active').length).toBe(2);
    clearAllActiveSegments(root);
    expect(root.querySelectorAll('.bcb-src-seg--active').length).toBe(0);
  });
});
