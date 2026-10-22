import { auth } from "@/lib/auth";

// Backs the Garmin connect/sync buttons on the home page: check the web session, then forward to the worker (Docker-internal, not exposed).
// Without WORKER_URL (e.g. deployed on Vercel with syncing done by a GitHub Action) these endpoints don't exist.
const ACTIONS: Record<string, true> = { status: true, login: true, mfa: true, sync: true, disconnect: true };

async function forward(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const worker = process.env.WORKER_URL;
  if (!worker || !Object.hasOwn(ACTIONS, action)) return Response.json({ error: "not found" }, { status: 404 });
  if (!(await auth.api.getSession({ headers: request.headers }))) {
    return Response.json({ error: "Please sign in first" }, { status: 401 });
  }
  const res = await fetch(`${worker}/${action}`, {
    method: request.method,
    headers: { "content-type": "application/json" },
    body: request.method === "POST" ? await request.text() : undefined,
    cache: "no-store",
  });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export { forward as GET, forward as POST };
