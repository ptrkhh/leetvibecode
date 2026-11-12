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

## Hosting

- Vercel project `leetvibecode`, Root Directory `launch`. Pushes to `main`
  deploy to production; pull requests get protected preview deployments.
- Domain `leetvibecode.authentyc.ai`: a CNAME in Cloudflare (DNS only, not
  proxied) to the target Vercel shows for the domain.
- Environment variables, as in `.env.example`:
  - `OPENROUTER_API_KEY`. The models are free, so the key's credit limit can
    stay at $0. Set a real limit before switching to paid models: it is the
    spend guard, and the in-app rate limit is only a speed bump.
  - `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`: the Authentyc
    Supabase project, through a secret key named `leetvibecode` that only this
    app uses. Revoke that key to cut this app off without touching Authentyc.
- `supabase/lvc_waitlist.sql` has been run in that project.

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
- `lib/models.ts` is the model list. The models are free, which caps the
  whole site at 50 model requests a day (6 plays) until the OpenRouter account
  has bought $10 of credits, then 1,000 a day. When the cap is hit, runs say so
  and are left out of the score. OpenRouter also retires models without notice;
  check this list first when runs come back "left out".

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

## Calibration so far

Two real plays on 2026-11-12, one careful prompt each, every model answering
both rounds: `lru-cache` scored 99 with 4,019 tokens (par 8,000) and
`rate-limiter` scored 99 with 4,269 tokens (par 7,000). Par is generous, and a
careful prompt reaches the top score. Recalibrate par, and check how far a
lazy prompt falls, once more plays are in.
