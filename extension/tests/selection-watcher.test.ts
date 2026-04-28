import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { watchSelection, type SelectionInfo } from '~/lib/selection-watcher';

interface FakeSelection {
  rangeCount: number;
  isCollapsed: boolean;
  toString(): string;
  getRangeAt(_i: number): { getBoundingClientRect(): DOMRect };
}

function makeSelection(text: string): FakeSelection {
  const rect = { x: 1, y: 2, width: 100, height: 20, top: 2, left: 1, right: 101, bottom: 22, toJSON: () => ({}) } as unknown as DOMRect;
  return {
    rangeCount: 1,
    isCollapsed: text.length === 0,
    toString: () => text,
    getRangeAt: () => ({ getBoundingClientRect: () => rect }),
  };
}

describe('selection-watcher', () => {
  let getSelectionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSelectionSpy = vi.spyOn(document, 'getSelection');
  });

  afterEach(() => {
    getSelectionSpy.mockRestore();
  });

  it('emits SelectionInfo when valid text is selected', () => {
    getSelectionSpy.mockReturnValue(makeSelection('hello world') as unknown as Selection);
    const cb = vi.fn<(s: SelectionInfo | null) => void>();
    const off = watchSelection(cb);

    document.dispatchEvent(new Event('selectionchange'));

    expect(cb).toHaveBeenCalledTimes(1);
    const arg = cb.mock.calls[0]?.[0];
    expect(arg).not.toBeNull();
    expect(arg?.text).toBe('hello world');
    expect(arg?.rect.width).toBe(100);

    off();
  });

  it('emits null when selection is collapsed or missing', () => {
    getSelectionSpy.mockReturnValue(null);
    const cb = vi.fn<(s: SelectionInfo | null) => void>();
    const off = watchSelection(cb);

    document.dispatchEvent(new Event('selectionchange'));

    expect(cb).toHaveBeenCalledWith(null);
    off();
  });

  it('emits null when selected text is shorter than 3 chars after trim', () => {
    getSelectionSpy.mockReturnValue(makeSelection('  a  ') as unknown as Selection);
    const cb = vi.fn<(s: SelectionInfo | null) => void>();
    const off = watchSelection(cb);

    document.dispatchEvent(new Event('selectionchange'));

    expect(cb).toHaveBeenCalledWith(null);
    off();
  });

  it('returned unsubscribe removes the listener', () => {
    getSelectionSpy.mockReturnValue(makeSelection('hello world') as unknown as Selection);
    const cb = vi.fn<(s: SelectionInfo | null) => void>();
    const off = watchSelection(cb);
    off();

    document.dispatchEvent(new Event('selectionchange'));

    expect(cb).not.toHaveBeenCalled();
  });
});
