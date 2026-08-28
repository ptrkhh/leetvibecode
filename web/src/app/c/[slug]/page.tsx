import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth";
import { getPublishedChallenge } from "../../../lib/queries";
import Editor from "./editor";

export default async function ChallengePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  // R12: getPublishedChallenge already IS this page's query -- Task 13 wrote
  // it for GET /api/challenges/[slug] and it fetches the same six fields plus
  // the isActive-filtered model roster. Reused rather than extended or
  // duplicated: the two consumers want identical data, which is the one case
  // R12 is actually about. Its R11 comment is also the single place recording
  // why referenceMs and followupPrompt are absent from the select.
  const c = await getPublishedChallenge(slug);
  if (!c) notFound();
  // Field by field rather than {...c}: a rest spread silently forwards
  // whatever the query grows next into the RSC payload, where it ships to the
  // browser in the HTML even though nothing renders it. Listing the fields
  // makes that a compile error instead of a leak.
  return (
    <Editor
      challenge={{
        slug: c.slug,
        title: c.title,
        description: c.description,
        interfaceText: c.interfaceText,
        difficulty: c.difficulty,
        parTokens: c.parTokens,
      }}
      // Only the display names: openrouterId is the roster's join key, not
      // something the page renders.
      models={c.models.map((m) => m.displayName)}
    />
  );
}
