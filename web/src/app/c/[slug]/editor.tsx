"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitPrompt } from "./submit";

// Exactly what this component renders, and nothing else. Everything handed to
// a client component is serialized into the RSC flight payload and shipped in
// the HTML whether or not it is rendered, so this type is the wire contract
// for the page: the challenge's id, referenceMs and followupPrompt are not
// here because they must not be on the client at all (R11).
export type Challenge = {
  slug: string;
  title: string;
  description: string;
  interfaceText: string;
  difficulty: string;
  parTokens: number;
};

// The server-side cap on promptText, so a prompt that would be rejected can
// never be typed. This matters more than a duplicated constant usually would:
// the 400 would arrive AFTER the attempt row exists, which is precisely how an
// attempt with no rounds gets stranded (see submit.ts).
const MAX_PROMPT = 20000;

export default function Editor({
  challenge,
  models,
}: {
  challenge: Challenge;
  models: string[];
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Survives a failed submit so the retry resumes that attempt instead of
  // creating another one (submit.ts).
  const [attemptId, setAttemptId] = useState<string | null>(null);
  // What is actually sent, and what the disabled check is computed from, so
  // the client and the route agree on the same bytes. A whitespace-only prompt
  // trims to "" and the route's `length < 1` would 400 -- again, after the
  // attempt row exists.
  const text = prompt.trim();

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <h1 className="text-2xl font-bold">{challenge.title}</h1>
        <p className="text-sm text-gray-600">
          {challenge.difficulty} · par {challenge.parTokens} tokens
        </p>
        <pre className="mt-4 whitespace-pre-wrap text-sm">{challenge.description}</pre>
        <h2 className="mt-4 font-semibold">Required interface</h2>
        <pre className="overflow-x-auto rounded bg-gray-100 p-3 text-sm dark:bg-gray-800">
          {challenge.interfaceText}
        </pre>
        {/* An empty roster is reachable: Model.isActive is a global
            kill-switch (spec L112) that can leave a challenge's whole roster
            deactivated. Submitting then guarantees the round route's 503 --
            after the attempt row is created -- so say so and disable the
            button instead of manufacturing a stranded attempt. */}
        {models.length > 0 ? (
          <p className="mt-4 text-sm">Model roster: {models.join(", ")}</p>
        ) : (
          <p className="mt-4 text-sm text-red-600">
            No models are active for this challenge right now, so it cannot be attempted.
          </p>
        )}
      </section>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          const res = await submitPrompt(challenge.slug, text, attemptId);
          setAttemptId(res.attemptId);
          // R63: only the error branch re-enables. Clearing busy before the
          // client-side navigation lands leaves a window in which a second
          // submit races the first. On success this component is about to
          // unmount.
          if (res.error) {
            setBusy(false);
            setError(res.error);
          } else {
            router.push(`/a/${res.attemptId}`);
          }
        }}
      >
        {/* A placeholder is not an accessible name -- it is announced as a
            value hint and vanishes once the field has content. aria-label is
            the name; aria-describedby ties the alert region below to the
            field so a screen reader reads the failure as part of it. */}
        <textarea
          className="h-96 rounded border p-3 font-mono text-sm"
          aria-label="Prompt"
          aria-describedby="editor-error"
          maxLength={MAX_PROMPT}
          placeholder="Write ONE prompt. It is sent to every model on the roster."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        {/* Always rendered, never `{error && ...}`: a live region has to be in
            the accessibility tree BEFORE its content changes to be announced
            reliably. Task 17 pins the id because getByRole("alert") is
            ambiguous app-wide -- Next injects its own empty
            <div role="alert" id="__next-route-announcer__">. */}
        <p id="editor-error" role="alert" className="text-sm text-red-600">
          {error}
        </p>
        <button
          type="submit"
          className="rounded bg-black p-3 text-white disabled:opacity-50"
          disabled={busy || text.length === 0 || models.length === 0}
        >
          {busy ? "Submitting…" : "Send to all models"}
        </button>
      </form>
    </div>
  );
}
