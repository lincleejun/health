import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { pool } from "./db";

// Single user: sign-up is allowed only while the database has no users, then closed for good.
async function signupGate() {
  const r = await pool.query('SELECT count(*)::int AS n FROM "user"');
  if (r.rows[0].n > 0) throw new APIError("FORBIDDEN", { message: "Sign-up is closed" });
}

// On Vercel use the project's production domain; locally use the URL from .env.local
const baseURL =
  process.env.BETTER_AUTH_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);

// Resource identifier of the MCP endpoint; tokens issued to AI assistants are valid only for it
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
    // Let ChatGPT, Claude, etc. connect to /api/mcp via OAuth: redirect to sign-in, then to the consent page for the user to approve
    mcp({
      loginPage: "/sign-in",
      consentPage: "/consent",
      resource: MCP_RESOURCE,
      scopes: ["openid", "profile", "offline_access", "health:read"],
      // Most clients still use dynamic client registration (DCR); registering only records a client — reading data still requires the user to sign in and consent
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    nextCookies(),
  ],
});
