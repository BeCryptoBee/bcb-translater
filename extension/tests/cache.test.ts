import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getCacheKey,
  getEntry,
  setEntry,
  type StorageAdapter,
  type CacheEntry,
} from '~/lib/cache';

function createMemoryStore(): StorageAdapter & { dump: () => Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    async get(keys: string[]) {
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        if (k in data) out[k] = data[k];
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) {
        data[k] = v;
      }
    },
    async remove(keys: string[]) {
      for (const k of keys) {
        delete data[k];
      }
    },
    dump() {
      return { ...data };
    },
  };
}

describe('cache', () => {
  describe('getCacheKey', () => {
    it('returns a stable hex hash for the same input', async () => {
      const k1 = await getCacheKey({ mode: 'translate', text: 'hello', targetLang: 'uk' });
      const k2 = await getCacheKey({ mode: 'translate', text: 'hello', targetLang: 'uk' });
      expect(k1).toBe(k2);
      expect(k1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different mode/text/lang', async () => {
      const a = await getCacheKey({ mode: 'translate', text: 'hello', targetLang: 'uk' });
      const b = await getCacheKey({ mode: 'summarize', text: 'hello', targetLang: 'uk' });
      const c = await getCacheKey({ mode: 'translate', text: 'world', targetLang: 'uk' });
      const d = await getCacheKey({ mode: 'translate', text: 'hello', targetLang: 'en' });
      expect(new Set([a, b, c, d]).size).toBe(4);
    });

    it('different segmented flag produces different keys', async () => {
      const a = await getCacheKey({
        mode: 'translate',
        text: 'hi',
        targetLang: 'uk',
        segmented: false,
      });
      const b = await getCacheKey({
        mode: 'translate',
        text: 'hi',
        targetLang: 'uk',
        segmented: true,
      });
      expect(a).not.toBe(b);
    });

    it('omitted segmented defaults to false (stable hash)', async () => {
      const a = await getCacheKey({ mode: 'translate', text: 'hi', targetLang: 'uk' });
      const b = await getCacheKey({
        mode: 'translate',
        text: 'hi',
        targetLang: 'uk',
        segmented: false,
      });
      expect(a).toBe(b);
    });
  });

  describe('setEntry / getEntry', () => {
    it('round-trips a value through the store', async () => {
      const store = createMemoryStore();
      const key = await getCacheKey({ mode: 'translate', text: 'hi', targetLang: 'uk' });
      await setEntry(key, 'привіт', store);
      expect(await getEntry(key, store)).toBe('привіт');
    });

    it('returns undefined when the key does not exist', async () => {
      const store = createMemoryStore();
      expect(await getEntry('nope', store)).toBeUndefined();
    });
  });

  describe('TTL', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns undefined and removes the entry when older than 7 days', async () => {
      const store = createMemoryStore();
      const key = await getCacheKey({ mode: 'translate', text: 'old', targetLang: 'uk' });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      await setEntry(key, 'старий', store);
      vi.setSystemTime(new Date('2026-01-08T00:00:01Z'));
      expect(await getEntry(key, store)).toBeUndefined();
      expect(await getEntry(key, store)).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entries first when total bytes exceed cap', async () => {
      const store = createMemoryStore();
      const big = 'x'.repeat(2 * 1024 * 1024); // 2 MB
      const k1 = await getCacheKey({ mode: 'translate', text: 'a', targetLang: 'uk' });
      const k2 = await getCacheKey({ mode: 'translate', text: 'b', targetLang: 'uk' });
      const k3 = await getCacheKey({ mode: 'translate', text: 'c', targetLang: 'uk' });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      await setEntry(k1, big, store);
      vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));
      await setEntry(k2, big, store);
      vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
      await setEntry(k3, big, store);
      vi.useRealTimers();

      // Cap is 4 MB; with three 2 MB entries (=6 MB) the oldest (k1) must be evicted.
      const dumped = store.dump();
      expect(dumped[k1]).toBeUndefined();
      expect((dumped[k2] as CacheEntry | undefined)?.value).toBe(big);
      expect((dumped[k3] as CacheEntry | undefined)?.value).toBe(big);
    });
  });
});
