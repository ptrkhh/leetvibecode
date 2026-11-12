// ponytail: per-instance memory. It resets on cold start and is not shared
// between serverless instances, so it only slows down casual abuse. The real
// spend guard is the credit limit on the OpenRouter key. Move to a shared
// store (Upstash, Postgres) when abuse shows up in the OpenRouter bill.
const hits = new Map<string, { count: number; reset: number }>();

export function rateLimit(request: Request, bucket: string, limit: number, windowMs: number): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const hit = hits.get(key);
  if (!hit || hit.reset < now) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  hit.count += 1;
  return hit.count <= limit;
}
