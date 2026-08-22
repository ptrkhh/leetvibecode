# LeetVibeCode — MVP Design

**Date:** 2026-08-22
**Status:** Approved design, pending implementation plan
**Goal:** Investor-demo-ready website in ~1 month

## Product Thesis

LeetVibeCode judges your *vibe coding* skill: the ability to write prompts that make any AI produce clean, extensible, performant code with minimal tokens. Prompts run on multiple standardized AI models; scoring is weighted toward the worst-performing model, so prompts must work universally — not just on one favorite model. Follow-up change requests measure whether the original prompt produced extensible architecture. Prompting doubles as a proxy for communication skill, making this more industry-relevant than traditional algorithmic interview prep.

## Core Loop

1. Player picks a challenge and sees the **brief** (description, required interface, example I/O) and the **model roster**.
2. **Round 1 (build):** player writes one prompt. It is sent to all N models (MVP: 4). Each model generates code independently.
3. Generated code runs hidden tests + performance benchmarks in sandbox. Player sees full results per model.
4. **Round 2 (extend):** platform issues a standardized follow-up request (e.g., "add burst mode"). Each model continues *its own conversation* — follow-up plus its own round-1 code. Re-tested against BOTH suites (old tests must still pass + new tests).
5. Final score computed from both rounds; attempt lands on the leaderboard.

Transparency rule: between rounds the player sees generated code, test pass/fail, benchmark timings, and scores per model. No black-box numbers anywhere — every score is decomposable into its parts.

## Scoring System

**Per-run score (one model × one round):**

```
R = Accuracy × (0.7 + 0.3 × Performance)
```

- Accuracy = passed tests / total tests.
- Performance = `min(1, reference_time / submission_time)` on benchmark inputs; timeout/crash → 0.
- Multiplicative gating: fast-but-wrong = 0; correct-and-fast beats correct-and-slow by at most 30%.

**Model weighting (worst weighted most):** models ranked by run score within the round, weighted as powers of two (worst ≈ 53%, then ≈ 27%, ≈ 13%, ≈ 7% for 4 models).

**Token efficiency:** total tokens (prompt + completion, summed across all models and rounds) vs. per-challenge par budget: `token_factor = min(1, par / total)`, floored at 0.25. A modifier, never dominant.

**Round weighting:** Round 1 = 40%, Round 2 = 60% (rewards extensible architecture).

**Final score:** `[0.4 × weighted_round1 + 0.6 × weighted_round2] × token_factor`, scaled 0–100.

## Architecture (Monolith-First MVP)

```
┌─────────────────────────┐       ┌──────────────────────────┐
│  Next.js App            │       │  Judge Service (FastAPI) │
│  - UI + NextAuth        │──────▶│  - DB-backed job queue   │
│  - API routes           │ poll │  - OpenRouter client     │
│  - Postgres (Prisma)    │◀──────│  - Docker sandbox pool   │
└─────────────────────────┘       │  - Test/bench runner     │
                                  └──────────────────────────┘
```

- **Web app (Next.js + TypeScript):** auth, challenge browsing, prompt editor, results dashboard, leaderboard. Owns business logic and score computation.
- **Judge service (Python FastAPI):** stateless workers pull jobs from a Postgres-backed queue (`SELECT ... FOR UPDATE SKIP LOCKED`). Responsibility: `(conversation_history, model, challenge)` → code, token counts, test results, benchmark timings. Returns raw facts only; interpretation lives in the web app.
- **Sandbox runner:** per-run Docker container — no network, read-only FS except `/work`, CPU/memory caps, 30s timeout per phase. Pool pre-warmed.
- **Postgres:** single datastore for app state and queue.
- **Deployment:** single host (Railway/Fly.io/VPS). Polling for job status, no websockets.
- Designed so the judge boundary allows later upgrade to Redis/S3 microservices without rewrite.

## Data Model

```
User              (id, email, name, passwordHash, createdAt)
Challenge         (id, slug, title, description, difficulty, parTokens,
                   followupPrompt, status, createdAt)
Attempt           (id, userId, challengeId, startedAt, completedAt, finalScore)
Round             (id, attemptId, index [0=build, 1=extend], promptText, submittedAt)
Model             (id, openrouterId, displayName, sizeTier, isActive)
Run               (id, roundId, modelId, jobId, generatedCode, promptTokens,
                   completionTokens, status[pending|generating|testing|done|error],
                   accuracy, perfScore, runScore, errorMessage)
Job               (id, runId, type[generate|test], state, claimedBy, claimedAt,
                   result, error, createdAt)
TestResult        (id, runId, name, passed, message, runtimeMs)
BenchmarkResult   (id, runId, inputSize, timeMs, memoryMb, timedOut)
LeaderboardEntry  (attemptId, userId, challengeId, score, totalTokens, rank)
```

- Attempt = one user × one challenge (full 2-round journey); final score denormalized for leaderboard queries.
- Run = one model × one round (8 runs per standard attempt).
- TestResult/BenchmarkResult kept per-run for drill-down transparency.

## Challenge Content Format

One directory per challenge, seeded into Postgres:

```
challenges/rate-limiter/
  challenge.yaml        # metadata + brief
  reference/solution.py # reference impl (perf baseline)
  tests/test_build.py   # hidden: initial-round suite
  tests/test_extend.py  # hidden: follow-up-round suite
  benchmarks/bench.py   # sized inputs, timing harness
```

```yaml
slug: rate-limiter
title: Token Bucket Rate Limiter
difficulty: medium
brief: <markdown shown to players>
interface: <exact signatures/docstrings shown to models>
parTokens: 2500
models: [qwen2.5-7b, llama3.1-8b, mistral-7b, gemma2-9b]
followup:
  prompt: "<standardized extension request>"
```

- Brief + interface public; tests hidden. All models receive identical contracts.
- Model selection: `challenge.yaml` lists its model roster; the global `Model.isActive` flag acts as a kill-switch filtering that roster at fan-out time (a deactivated model is skipped everywhere without touching challenge files).
- Round 2 runs both suites — old suite passing measures extensibility mechanically.
- Code extraction: last fenced Python block in model response; none → run fails with player-facing hint.
- MVP content: 8 challenges across easy→hard, mixing algorithmic and small-system-design tasks.

## UI

1. **Home/challenge list** — browse challenges, difficulty badges, personal bests.
2. **Challenge/prompt editor** — brief + interface left, prompt editor right, model roster shown, submit fans out to all models.
3. **Results dashboard — Model Cards Grid (chosen):** four model cards side-by-side, each showing generated code, test results, benchmark times, run score. Weighted math strip below the grid. Round switcher between build/extend rounds.
4. **Leaderboard** — per-challenge rankings with score + tokens.

## Error Handling & Edge Cases

- **Model/API failure:** retry ×2 with backoff → run errors with visible message, scores 0, attempt continues.
- **No code block:** run fails with hint ("try specifying output format").
- **Sandbox containment:** no network, resource caps, timeouts; hostile code = failed tests.
- **Anti-cheese:** raw stdout never returned to player (pass/fail + sanitized messages only); system-prompt wrapper hardens against embedded instruction attempts.
- **Cost guards:** hard token cap per attempt, daily quota per user, per-model concurrency limits.
- **Abandonment:** mid-attempt quit marks attempt abandoned; excluded from leaderboard.

## Testing Strategy

- **Scoring math:** pure functions; exhaustive unit + golden snapshot tests. Most-tested code in the repo.
- **Judge service:** integration tests with canned OpenRouter responses; sandbox verified against hostile samples (fork bombs, network calls, infinite loops).
- **Challenge CI:** reference solution must pass its own tests + benchmarks before publish.
- **E2E:** Playwright drives login → prompt → mock judge → results → follow-up → leaderboard via mock-judge mode (no real tokens burned).

## MVP Scope Summary

- 8 challenges, 4 active small open-source models via OpenRouter, 2 rounds per attempt.
- Email auth, personal history, global per-challenge leaderboard.
- Single-host deployment; polling; no realtime infra.
- Timeline: ~1 month.

## Explicitly Out of Scope (Post-MVP)

- Weekly challenges / tiers with larger proprietary models (schema supports via Model.isActive + sizeTier).
- Multi-language support (Python-only for MVP).
- Replay sharing, share cards, social features.
- Queue/microservice scaling beyond single host.
