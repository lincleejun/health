import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { auth, MCP_RESOURCE } from "@/lib/auth";
import { buildMcpServer } from "@/lib/mcp";

const serve = (request: Request) => createMcpHandler(() => buildMcpServer()).fetch(request);

// Cloud assistants (ChatGPT, Claude) use OAuth; the token must carry health:read
const viaOAuth = requireMcpAuth(
  auth,
  (request, claims) =>
    String(claims.scope ?? "").split(" ").includes("health:read")
      ? serve(request)
      : Response.json({ error: "Missing health:read scope" }, { status: 403 }),
  { resource: MCP_RESOURCE },
);

export async function POST(request: Request) {
  // Local agents use access tokens generated on the home page. JWTs contain dots; access tokens don't.
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer && !bearer.includes(".")) {
    const r = await auth.api.verifyApiKey({ body: { key: bearer } });
    if (!r.valid) return Response.json({ error: "Access token is invalid or revoked" }, { status: 401 });
    return serve(request);
  }
  return viaOAuth(request);
}
