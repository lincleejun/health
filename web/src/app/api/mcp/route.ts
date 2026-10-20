import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { auth, MCP_RESOURCE } from "@/lib/auth";
import { buildMcpServer } from "@/lib/mcp";

const serve = (request: Request) => createMcpHandler(() => buildMcpServer()).fetch(request);

// 云端助手（ChatGPT、Claude）走 OAuth，令牌里要有 health:read
const viaOAuth = requireMcpAuth(
  auth,
  (request, claims) =>
    String(claims.scope ?? "").split(" ").includes("health:read")
      ? serve(request)
      : Response.json({ error: "缺少 health:read 权限" }, { status: 403 }),
  { resource: MCP_RESOURCE },
);

export async function POST(request: Request) {
  // 本地 agent 用首页生成的访问令牌。JWT 里有点号，访问令牌没有。
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer && !bearer.includes(".")) {
    const r = await auth.api.verifyApiKey({ body: { key: bearer } });
    if (!r.valid) return Response.json({ error: "访问令牌无效或已撤销" }, { status: 401 });
    return serve(request);
  }
  return viaOAuth(request);
}
