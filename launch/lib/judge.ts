// Browser-side judge. Model-generated code runs in a Pyodide web worker in the
// visitor's own browser, never on our servers.
//
// ponytail: because the judge is client-side, the tests and the reference
// solution ship to the browser and a score can be forged. Fine while there is
// no leaderboard. Before scores are stored or compared, move the judge to the
// server (the sandboxed service in ../judge).

export type TestResult = { suite: string; name: string; passed: boolean; message: string };

export type JudgeResult = {
  load_error: string | null;
  tests: TestResult[];
  sub_ms: number | null;
  ref_ms: number | null;
  bench_error: string | null;
};

export type JudgeInput = {
  harness: string;
  code: string;
  suites: { name: string; src: string }[];
  bench: string;
  reference: string;
};

const TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function start(): Promise<void> {
  if (ready) return ready;
  const w = new Worker('/py-worker.js', { type: 'module' });
  worker = w;
  ready = new Promise<void>((resolve, reject) => {
    w.onmessage = (event) => {
      if (event.data.type === 'ready') resolve();
      if (event.data.type === 'fatal') reject(new Error(event.data.error));
    };
    w.onerror = () => reject(new Error('worker failed to start'));
  });
  ready.catch(stop);
  return ready;
}

function stop() {
  worker?.terminate();
  worker = null;
  ready = null;
}

/** Start downloading the Python runtime. Resolves when it can run code. */
export function warmUp(): Promise<void> {
  return start();
}

const failure = (message: string): JudgeResult => ({
  load_error: message,
  tests: [],
  sub_ms: null,
  ref_ms: null,
  bench_error: null,
});

async function runOnce(input: JudgeInput): Promise<JudgeResult> {
  try {
    await start();
  } catch {
    return failure('The in-browser Python runtime did not load. Check your connection and run again.');
  }
  const w = worker!;
  return new Promise<JudgeResult>((resolve) => {
    // The timer starts after the runtime is ready, so a slow download is not a timeout.
    const timer = setTimeout(() => {
      stop(); // an endless loop can only be stopped by killing the worker
      resolve(failure('Timed out after 30 seconds.'));
    }, TIMEOUT_MS);
    w.onmessage = (event) => {
      if (event.data.type !== 'result') return;
      clearTimeout(timer);
      resolve(event.data.ok ? event.data.result : failure(event.data.error));
    };
    w.postMessage({
      harness: input.harness,
      payload: {
        code: input.code,
        suites: input.suites,
        bench: input.bench,
        reference: input.reference,
      },
    });
  });
}

/** Runs are queued: one worker, one submission at a time, so timings do not fight each other. */
export function judge(input: JudgeInput): Promise<JudgeResult> {
  const next = queue.then(() => runOnce(input));
  queue = next.catch(() => undefined);
  return next;
}
