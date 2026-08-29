import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth";
import Dashboard from "./dashboard";

// A thin shell, exactly like Task 18's. No query here: the dashboard polls
// GET /api/attempts/[id] anyway, and that route already owns the ownership
// boundary (a foreign or missing attempt is byte-identically 404), so a server
// query would be a second copy of the same rule with nothing to keep them in
// agreement. Nothing but the URL's own id crosses into the client component,
// so there is no server value here that can reach the RSC payload (R60).
export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Carry the destination the way Task 18 does: a shared attempt link followed
  // while logged out otherwise lands on the home page with no idea what was
  // being looked at. safeCallbackUrl re-validates it on the way back out.
  const session = await getServerSession(authOptions);
  if (!session) redirect(`/login?callbackUrl=/a/${encodeURIComponent(id)}`);
  return <Dashboard id={id} />;
}
