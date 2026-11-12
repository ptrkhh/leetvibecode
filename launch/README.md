# LeetVibeCode

An Authentyc product. One prompt, four small models, scored on the weakest.

This folder is the launch build: one Next.js app that runs on Vercel with no
server of its own. The full MVP (accounts, leaderboard, sandboxed judge) is in
`../web` and `../judge` and needs a Docker host; see the root `README.md`.

Visitors pick a challenge, write a single prompt, and watch four models build
from it. Round 2 sends each model a follow-up request in its own conversation.
Every score is shown with the parts it is made of. There is a waitlist and no
login.

The site shares its look with authentyc.ai on purpose: same palette, type,
panels, top bar and footer. `app/globals.css`, `tailwind.config.ts`,
`components/SiteNav.tsx` and `components/SiteFooter.tsx` each name the
Authentyc file they mirror. Change both sides together.

## Run it

Use WSL/Linux Node 22 (the installed `node_modules` are Linux builds).

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # scoring math + every reference solution against its tests
```

Without `OPENROUTER_API_KEY` the site runs in demo mode: three models return
the reference solution, one returns no code, and a banner says so.

## Go live

1. Import the GitHub repo in Vercel and set Root Directory to `launch`.
2. In Vercel, set the environment variables from `.env.example`:
   - `OPENROUTER_API_KEY`. Set a credit limit on the key in the OpenRouter
     dashboard first. That limit is the spend guard; the in-app rate limit is
     only a speed bump.
   - `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`, same values as the
     Authentyc project.
3. Run `supabase/lvc_waitlist.sql` once in the Supabase SQL editor.
4. In Vercel, add the domain `leetvibecode.authentyc.ai`. In Cloudflare, add
   the CNAME record Vercel shows (DNS only, not proxied).
5. Play one challenge on the live site with the real models. The model path
   has only been exercised in demo mode; see "Not verified yet" below.

## How it works

- `app/api/generate` sends one prompt to one model through OpenRouter. The
  browser calls it four times in parallel, so each model card fills in on its
  own. Temperature 0 and a fixed seed keep reruns close to repeatable.
- `public/py-worker.js` runs the generated code in the visitor's browser with
  Pyodide. `challenges/harness.py` runs the tests and times the code against
  the reference solution, taking the best of five runs each, in turns.
- `lib/scoring.ts` is the scoring math from the design doc, as pure functions.
- `challenges/<slug>/` holds a reference solution, the two test suites and the
  benchmark. Text shown to players is in `lib/challenges.ts`.
- `lib/models.ts` is the model list. OpenRouter retires models without notice;
  check it first when runs come back "left out".

## What differs from the MVP

`../docs/superpowers/specs/2026-08-22-leetvibecode-mvp-design.md` describes the
full product, and `../web` plus `../judge` implement it. This launch is
deliberately smaller:

- No accounts, history or leaderboard. A waitlist instead.
- The judge runs in the browser, not in a sandboxed server. That means the
  tests and reference solutions are visible to anyone who looks, and a score
  can be forged. Acceptable while nothing is stored or ranked. Before scores
  count for anything, use the sandboxed judge in `../judge`.
- Three challenges, not eight. They are written for the browser harness and
  are separate from `../challenges`: `merge-intervals` exists only here, and
  `lru-cache` and `rate-limiter` have their own tests, follow-ups and par
  budgets. Scores here and in the MVP are not comparable.
- Its own model list in `lib/models.ts`. Three of the four models named in
  `../challenges/*/challenge.yaml` are no longer listed on OpenRouter.
- One Next.js app on Vercel, with Supabase for the waitlist. No FastAPI judge,
  no Prisma, no NextAuth.
- The models are told to answer with one Python code block, so a first-time
  player is not punished for output format.
- Speed uses the best of five interleaved runs instead of the median of three.
  The median let identical code score anywhere from 72% to 100%.
- The reference time is measured on the visitor's device during each run, not
  stored at publish time.

## Not verified yet

- Real model calls. No OpenRouter key was available during the build, so the
  request shape, the four model IDs and the par token budgets in
  `lib/challenges.ts` are untested against live models.
- The waitlist insert against a real Supabase project.
