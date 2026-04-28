import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getLocalQuota, incrementLocalQuota } from '~/lib/quota';

function stubChromeStorageLocal(): { dump: () => Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  const local = {
    async get(keys: string[] | string | Record<string, unknown> | null) {
      const out: Record<string, unknown> = {};
      const list = Array.isArray(keys) ? keys : keys == null ? Object.keys(data) : [keys as string];
      for (const k of list) {
        if (k in data) out[k] = data[k];
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) {
        data[k] = v;
      }
    },
    async remove(keys: string[] | string) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete data[k];
    },
  };
  vi.stubGlobal('chrome', { storage: { local } });
  return { dump: () => ({ ...data }) };
}

describe('quota', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T12:00:00Z'));
    stubChromeStorageLocal();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts at 0 when no entry exists for today', async () => {
    expect(await getLocalQuota()).toBe(0);
  });

  it('increments the counter for the current day', async () => {
    expect(await getLocalQuota()).toBe(0);
    await incrementLocalQuota();
    expect(await getLocalQuota()).toBe(1);
    await incrementLocalQuota();
    await incrementLocalQuota();
    expect(await getLocalQuota()).toBe(3);
  });

  it('separate UTC days do not share counters', async () => {
    vi.setSystemTime(new Date('2026-04-28T23:59:00Z'));
    await incrementLocalQuota();
    await incrementLocalQuota();
    expect(await getLocalQuota()).toBe(2);

    vi.setSystemTime(new Date('2026-04-29T00:00:01Z'));
    expect(await getLocalQuota()).toBe(0);
    await incrementLocalQuota();
    expect(await getLocalQuota()).toBe(1);

    // Going back to the previous day still sees the original count.
    vi.setSystemTime(new Date('2026-04-28T23:59:30Z'));
    expect(await getLocalQuota()).toBe(2);
  });
});
