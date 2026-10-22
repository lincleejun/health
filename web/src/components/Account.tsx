"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setPending(true);
    setError("");
    const res =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(f.get("name")) });
    setPending(false);
    if (res.error) return setError(res.error.message ?? "Something went wrong, please try again");
    // When sign-in was reached from an AI assistant's authorization flow, return to that flow afterwards
    const next = res.data as { redirect?: boolean; url?: string } | null;
    if (next?.redirect && next.url) return window.location.assign(next.url);
    // Full-page navigation: router.push("/") would reuse the cached pre-login "/ → /sign-in" redirect and stay on the sign-in page
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  return (
    <form onSubmit={submit} className="stack">
      {error && <div className="err" role="alert">{error}</div>}
      {mode === "sign-up" && <div><label className="lbl" htmlFor="name">Name</label><input id="name" name="name" className="input" required autoComplete="name" /></div>}
      <div><label className="lbl" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" required autoComplete="email" /></div>
      <div><label className="lbl" htmlFor="password">Password{mode === "sign-up" && " (at least 10 characters)"}</label><input id="password" name="password" type="password" className="input" required minLength={mode === "sign-up" ? 10 : undefined} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} /></div>
      <button className="btn pri full" disabled={pending}>{mode === "sign-in" ? "Sign in" : "Sign up"}</button>
    </form>
  );
}

export function SignOut() {
  const router = useRouter();
  return (
    <button className="btn full" onClick={async () => { await authClient.signOut(); router.push("/sign-in"); router.refresh(); }}>
      Sign out
    </button>
  );
}

type Key = { id: string; name: string | null; start: string | null; createdAt: Date | string };

// Access tokens for local AI agents. The plaintext is shown only once, at creation.
export function Tokens({ mcpUrl }: { mcpUrl: string }) {
  const [keys, setKeys] = useState<Key[]>([]);
  const [fresh, setFresh] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    authClient.apiKey.list().then((res) => {
      const data = res.data as unknown as { apiKeys?: Key[] } | Key[] | null;
      setKeys(Array.isArray(data) ? data : data?.apiKeys ?? []);
    });
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") || "AI assistant");
    const res = await authClient.apiKey.create({ name });
    if (res.error) return setError(res.error.message ?? "Failed to create token");
    setFresh(res.data.key);
    e.currentTarget?.reset();
    load();
  }

  return (
    <>
      {keys.map((k) => (
        <div className="line" key={k.id}>
          <div>{k.name ?? "Unnamed"}<small className="mono">{k.start}…</small></div>
          <button className="btn sm danger" onClick={async () => { await authClient.apiKey.delete({ keyId: k.id }); load(); }}>Revoke</button>
        </div>
      ))}
      <form onSubmit={create} className="line" style={{ gap: 8 }}>
        <input name="name" className="input" placeholder="What it's for, e.g. Claude Code" aria-label="Token name" />
        <button className="btn sm" style={{ whiteSpace: "nowrap" }}>New token</button>
      </form>
      {fresh && (
        <div className="okmsg" style={{ marginBottom: 12 }}>
          Copy it now; it won&apos;t be shown again:<br /><span className="mono">{fresh}</span>
          <br /><br />Add to Claude Code:<br />
          <span className="mono">claude mcp add --transport http health {mcpUrl} --header &quot;Authorization: Bearer {fresh}&quot;</span>
        </div>
      )}
      {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}
    </>
  );
}
