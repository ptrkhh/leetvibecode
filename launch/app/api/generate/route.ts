import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getChallenge } from '@/lib/challenges';
import { MODELS } from '@/lib/models';
import { rateLimit } from '@/lib/ratelimit';

// One model, one round per request. The browser fires four of these in
// parallel so each model card fills in as soon as its own reply lands.
export const maxDuration = 60;

const MAX_PROMPT = 4000;
const MAX_HISTORY = 20_000;

type Message = { role: 'user' | 'assistant'; content: string };

// No system role: some small models reject it. The contract rides in the first user turn.
const contract = (iface: string) =>
  `Reply with exactly one fenced Python code block containing the complete solution. Use only the Python standard library. Do not include tests or example usage.

Required interface:
${iface}

Task:
`;

const FENCE = /```(?:python|py)?[ \t]*\r?\n([\s\S]*?)```/g;

/** Last fenced block in the reply, or null when there is none. */
function extractCode(text: string): string | null {
  let last: string | null = null;
  for (const match of text.matchAll(FENCE)) last = match[1];
  return last && last.trim() ? last : null;
}

async function callModel(model: string, messages: Message[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'content-type': 'application/json',
        },
        // temperature 0 + fixed seed: the same prompt should score the same twice.
        body: JSON.stringify({ model, messages, temperature: 0, seed: 7, max_tokens: 1200 }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`OpenRouter responded ${response.status}`);
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('OpenRouter returned no text');
      return {
        content,
        promptTokens: Number(data.usage?.prompt_tokens) || 0,
        completionTokens: Number(data.usage?.completion_tokens) || 0,
      };
    } catch (error) {
      if (attempt >= 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
}

/** Demo mode: three models return the reference solution, one returns no code. */
async function mockModel(slug: string, modelIndex: number, messages: Message[]) {
  await new Promise((resolve) => setTimeout(resolve, 500 + modelIndex * 450));
  const content =
    modelIndex === MODELS.length - 1
      ? 'Good question. I would keep the state in a small structure and update it on each call. Tell me if you want me to write the code.'
      : 'Here is the solution.\n\n```python\n' +
        readFileSync(path.join(process.cwd(), 'challenges', slug, 'reference.py'), 'utf8') +
        '```\n';
  const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  return {
    content,
    promptTokens: Math.ceil(promptChars / 4),
    completionTokens: Math.ceil(content.length / 4),
  };
}

export async function POST(request: Request) {
  // 40 calls per 10 minutes = 5 full plays (8 calls each).
  if (!rateLimit(request, 'generate', 40, 10 * 60_000)) {
    return Response.json(
      { error: 'Too many runs from your network. Wait a few minutes and try again.' },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const challenge = typeof body?.slug === 'string' ? getChallenge(body.slug) : undefined;
  const modelIndex = body?.model;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const round1 = body?.round1;
  if (
    !challenge ||
    !Number.isInteger(modelIndex) ||
    modelIndex < 0 ||
    modelIndex >= MODELS.length ||
    !prompt ||
    prompt.length > MAX_PROMPT ||
    (round1 !== undefined && (typeof round1 !== 'string' || !round1 || round1.length > MAX_HISTORY))
  ) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const messages: Message[] = [{ role: 'user', content: contract(challenge.interface) + prompt }];
  if (round1 !== undefined) {
    messages.push({ role: 'assistant', content: round1 }, { role: 'user', content: challenge.followup });
  }

  const mock = !process.env.OPENROUTER_API_KEY;
  try {
    const reply = mock
      ? await mockModel(challenge.slug, modelIndex, messages)
      : await callModel(MODELS[modelIndex].id, messages);
    return Response.json({ ...reply, code: extractCode(reply.content), mock });
  } catch (error) {
    console.error('[generate]', MODELS[modelIndex].id, error instanceof Error ? error.message : error);
    return Response.json(
      { error: 'The model did not answer. This run is left out of your score.' },
      { status: 502 },
    );
  }
}
