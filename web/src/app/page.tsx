import { SignOut, Tokens } from "@/components/Account";
import { Garmin } from "@/components/Garmin";
import { MCP_RESOURCE } from "@/lib/auth";
import { requireUser } from "@/lib/session";

// Depends on the session, so don't prerender
export const instant = false;

export default async function Home() {
  const user = await requireUser();
  return (
    <main className="auth">
      <h1>Health Data</h1>
      <p>Signed in as {user.email}.</p>
      {process.env.WORKER_URL && (
        <>
          <div className="sect">Garmin</div>
          <div style={{ marginTop: 6 }}><Garmin /></div>
        </>
      )}
      <div className="sect">MCP URL</div>
      <p className="mono" style={{ marginTop: 6 }}>{MCP_RESOURCE}</p>
      <p>Use this URL when adding a custom MCP server in ChatGPT or Claude, then sign in and authorize when prompted (requires a public HTTPS URL). Local agents use the access tokens below.</p>
      <div className="sect">Local agent access tokens</div>
      <div className="card" style={{ padding: "2px 14px", marginTop: 6 }}>
        <Tokens mcpUrl={MCP_RESOURCE} />
      </div>
      <div style={{ marginTop: 16 }}><SignOut /></div>
    </main>
  );
}
