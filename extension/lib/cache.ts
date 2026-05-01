export interface CacheEntry {
  value: string;
  ts: number;
  bytes: number;
}

export interface StorageAdapter {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB cap (under 5 MB chrome.storage.local quota)
const INDEX_KEY = '__cache_index__';

export async function getCacheKey(input: {
  mode: string;
  text: string;
  targetLang: string;
  segmented?: boolean;
}): Promise<string> {
  const seg = input.segmented ? '1' : '0';
  const data = new TextEncoder().encode(
    `${input.mode}|${input.targetLang}|seg=${seg}|${input.text}`,
  );
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function getEntry(key: string, store: StorageAdapter): Promise<string | undefined> {
  const got = await store.get([key]);
  const entry = got[key] as CacheEntry | undefined;
  if (!entry) return undefined;
  if (Date.now() - entry.ts > TTL_MS) {
    await store.remove([key]);
    return undefined;
  }
  return entry.value;
}

export async function setEntry(
  key: string,
  value: string,
  store: StorageAdapter,
): Promise<void> {
  const bytes = new Blob([value]).size;
  const entry: CacheEntry = { value, ts: Date.now(), bytes };
  const idxRaw = (await store.get([INDEX_KEY]))[INDEX_KEY] as
    | Record<string, number>
    | undefined;
  const idx: Record<string, number> = idxRaw ?? {};
  idx[key] = entry.ts;
  await store.set({ [key]: entry });
  await evictIfNeeded(idx, store);
  await store.set({ [INDEX_KEY]: idx });
}

async function evictIfNeeded(
  idx: Record<string, number>,
  store: StorageAdapter,
): Promise<void> {
  const keys = Object.keys(idx);
  if (keys.length === 0) return;
  const entries = await store.get(keys);
  let total = 0;
  for (const k of keys) {
    const e = entries[k] as CacheEntry | undefined;
    if (e) total += e.bytes;
  }
  if (total <= MAX_BYTES) return;
  // Evict oldest first until under cap
  const sorted = [...keys].sort((a, b) => (idx[a] ?? 0) - (idx[b] ?? 0));
  for (const k of sorted) {
    if (total <= MAX_BYTES) break;
    const e = entries[k] as CacheEntry | undefined;
    if (e) total -= e.bytes;
    delete idx[k];
    await store.remove([k]);
  }
}
