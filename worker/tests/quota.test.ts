import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkAndIncrement } from '../src/quota';

function makeKV(): KVNamespace {
  const m = new Map<string, string>();
  return {
    async get(k: string) {
      return m.get(k) ?? null;
    },
    async put(k: string, v: string) {
      m.set(k, v);
    },
    async delete(k: string) {
      m.delete(k);
    },
  } as unknown as KVNamespace;
}

describe('checkAndIncrement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at 0 and returns allowed:true with remaining 49 on first call', async () => {
    const kv = makeKV();
    const r = await checkAndIncrement(kv, 'install-1');
    expect(r).toEqual({ allowed: true, remaining: 49 });
  });

  it('increments correctly across consecutive calls', async () => {
    const kv = makeKV();
    const r1 = await checkAndIncrement(kv, 'install-1');
    const r2 = await checkAndIncrement(kv, 'install-1');
    const r3 = await checkAndIncrement(kv, 'install-1');
    expect(r1.remaining).toBe(49);
    expect(r2.remaining).toBe(48);
    expect(r3.remaining).toBe(47);
  });

  it('returns allowed:false with remaining 0 once 50 calls have been counted', async () => {
    const kv = makeKV();
    // Pre-fill to 50 directly to avoid 50 sequential calls.
    await kv.put('quota:install-1:2026-04-28', '50');
    const r = await checkAndIncrement(kv, 'install-1');
    expect(r).toEqual({ allowed: false, remaining: 0 });
  });

  it('allows the 50th call and rejects the 51st', async () => {
    const kv = makeKV();
    await kv.put('quota:install-1:2026-04-28', '49');
    const r50 = await checkAndIncrement(kv, 'install-1');
    expect(r50).toEqual({ allowed: true, remaining: 0 });
    const r51 = await checkAndIncrement(kv, 'install-1');
    expect(r51).toEqual({ allowed: false, remaining: 0 });
  });

  it('does not share counters between different installIds', async () => {
    const kv = makeKV();
    await kv.put('quota:install-A:2026-04-28', '50');
    const a = await checkAndIncrement(kv, 'install-A');
    const b = await checkAndIncrement(kv, 'install-B');
    expect(a.allowed).toBe(false);
    expect(b).toEqual({ allowed: true, remaining: 49 });
  });

  it('does not share counters between different days for the same installId', async () => {
    const kv = makeKV();
    // Yesterday already at 50.
    await kv.put('quota:install-1:2026-04-27', '50');
    const r = await checkAndIncrement(kv, 'install-1');
    expect(r).toEqual({ allowed: true, remaining: 49 });
  });

  it('writes the updated counter under the day-scoped key', async () => {
    const kv = makeKV();
    await checkAndIncrement(kv, 'install-1');
    const stored = await kv.get('quota:install-1:2026-04-28');
    expect(stored).toBe('1');
  });
});
