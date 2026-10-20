import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { pool } from "./db";

// 只有一个用户：库里还没有人时允许注册，之后注册一律关闭。
async function signupGate() {
  const r = await pool.query('SELECT count(*)::int AS n FROM "user"');
  if (r.rows[0].n > 0) throw new APIError("FORBIDDEN", { message: "已关闭注册" });
}

// 部署在 Vercel 时用项目的正式域名；本地用 .env.local 里的地址
const baseURL =
  process.env.BETTER_AUTH_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);

// MCP 端点的资源标识，AI 助手拿到的令牌只对它有效
export const MCP_RESOURCE = `${baseURL ?? "http://localhost:3000"}/api/mcp`;

export const auth = betterAuth({
  baseURL,
  database: pool,
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") await signupGate();
    }),
  },
  plugins: [
    apiKey(),
    jwt(),
    // 让 ChatGPT、Claude 等通过 OAuth 连接 /api/mcp：跳到登录页，再到授权页由用户确认
    mcp({
      loginPage: "/sign-in",
      consentPage: "/consent",
      resource: MCP_RESOURCE,
      scopes: ["openid", "profile", "offline_access", "health:read"],
      // 多数客户端仍用动态注册（DCR）；注册只是登记一个客户端，访问数据仍要用户登录并同意
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    nextCookies(),
  ],
});
