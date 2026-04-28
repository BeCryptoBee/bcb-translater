const DAILY_LIMIT = 50;

export async function checkAndIncrement(
  kv: KVNamespace,
  installId: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `quota:${installId}:${date}`;
  const current = Number((await kv.get(key)) ?? 0);
  if (current >= DAILY_LIMIT) return { allowed: false, remaining: 0 };
  await kv.put(key, String(current + 1), { expirationTtl: 60 * 60 * 26 });
  return { allowed: true, remaining: DAILY_LIMIT - (current + 1) };
}
