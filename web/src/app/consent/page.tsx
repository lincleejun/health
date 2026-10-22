import { headers } from "next/headers";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { ConsentForm } from "@/components/Consent";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/session";

export const instant = false;

// Authorization page shown when an AI assistant asks to connect. The link parameters are signed by the server; verify before showing anything.
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const all = await searchParams;
  await requireUser();
  // Rebuild the original query string before verifying: repeated parameters must each be added back
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(all)) for (const one of [v].flat()) qs.append(k, one);
  const query = qs.toString();
  const params = { client_id: qs.get("client_id") ?? "", scope: qs.get("scope") ?? "" };
  const { secret } = await auth.$context;
  const valid = await verifyOAuthQueryParams(query, secret);
  let clientName = "An AI assistant";
  if (valid && params.client_id) {
    const client = await auth.api
      .getOAuthClientPublic({ query: { client_id: params.client_id }, headers: await headers() })
      .catch(() => null);
    clientName = client?.client_name || clientName;
  }

  return (
    <main className="auth">
      <h1>Connect Health Data</h1>
      {valid ? (
        <>
          <p><b style={{ color: "var(--text)" }}>{clientName}</b> wants to read your health data. It can only query, not modify, and you can disconnect it anytime from the home page.</p>
          <ConsentForm requested={params.scope.split(" ").filter(Boolean)} />
        </>
      ) : (
        <div className="err">This authorization link is invalid or has expired. Go back to your AI assistant and connect again.</div>
      )}
    </main>
  );
}
