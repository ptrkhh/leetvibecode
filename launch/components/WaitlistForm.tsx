'use client';

import { useState } from 'react';

type State = { kind: 'idle' | 'sending' | 'joined' } | { kind: 'error'; message: React.ReactNode };

export function WaitlistForm() {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    setState({ kind: 'sending' });
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (response.ok) return setState({ kind: 'joined' });
      const data = await response.json().catch(() => ({}));
      setState({
        kind: 'error',
        message:
          data.error === 'not_configured' ? (
            <>
              The waitlist is not connected yet. Email{' '}
              <a href="mailto:hello@authentyc.ai" className="underline">
                hello@authentyc.ai
              </a>{' '}
              and we will add you.
            </>
          ) : (
            (data.error ?? 'Could not save your email. Try again in a moment.')
          ),
      });
    } catch {
      setState({ kind: 'error', message: 'No connection. Check your network and try again.' });
    }
  }

  if (state.kind === 'joined') {
    return (
      <p role="status" className="text-lg text-white">
        You are on the waitlist. We will email you when accounts open.
      </p>
    );
  }

  return (
    <form onSubmit={join} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="waitlist-email" className="sr-only">
          Email address
        </label>
        <input
          id="waitlist-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="field sm:flex-1"
        />
        <button type="submit" disabled={state.kind === 'sending'} className="btn-primary">
          {state.kind === 'sending' ? 'Joining' : 'Join the waitlist'}
        </button>
      </div>
      <p role="alert" className="min-h-6 text-sm text-red-300">
        {state.kind === 'error' ? state.message : null}
      </p>
      <p className="text-sm text-gray-400">
        We only use your email to tell you about LeetVibeCode.{' '}
        <a href="https://authentyc.ai/privacy" className="underline hover:text-white">
          Privacy policy
        </a>
      </p>
    </form>
  );
}
