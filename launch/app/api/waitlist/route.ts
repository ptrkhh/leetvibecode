import { rateLimit } from '@/lib/ratelimit';

// Stores the email in lvc_waitlist (supabase/lvc_waitlist.sql) through
// Supabase's REST API. Duplicates are ignored and get the same answer as new
// signups, so the endpoint does not reveal who is already on the list.
export async function POST(request: Request) {
  if (!rateLimit(request, 'waitlist', 5, 60 * 60_000)) {
    return Response.json({ error: 'Too many attempts. Try again in an hour.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  const response = await fetch(`${url}/rest/v1/lvc_waitlist?on_conflict=email`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!response?.ok) {
    console.error('[waitlist] insert failed', response?.status ?? 'network error');
    return Response.json({ error: 'Could not save your email. Try again in a moment.' }, { status: 502 });
  }
  return Response.json({ ok: true });
}
