"use client";
import { useCallback, useEffect, useState } from "react";

type Status = {
  connected: boolean;
  mfa: boolean;
  syncing: boolean;
  last_sync: string | null;
  error: string | null;
  days: number;
  first_day: string | null;
  last_day: string | null;
  activities: number;
  timezone: string;
};

async function call(action: string, body?: object) {
  const res = await fetch(
    `/api/garmin/${action}`,
    body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : { cache: "no-store" },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status})`);
  return data;
}

// Connect a Garmin account, view sync status, and sync manually. Credentials are only passed to the worker to obtain tokens and are never stored.
export function Garmin() {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(() => call("status").then(setS, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!s?.syncing) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [s?.syncing, load]);

  async function act(action: string, body: object = {}) {
    setPending(true);
    setError("");
    try {
      await call(action, body);
    } catch (e) {
      setError((e as Error).message);
    }
    await load();
    setPending(false);
  }

  function submit(action: string) {
    return (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.currentTarget));
      act(action, { ...body, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    };
  }

  if (!s) return error ? <div className="err">{error}</div> : null;

  const err = (error || s.error) && <div className="err" role="alert">{error || s.error}</div>;

  if (!s.connected && s.mfa) {
    return (
      <form onSubmit={submit("mfa")} className="stack">
        {err}
        <div>
          <label className="lbl" htmlFor="code">Verification code from Garmin</label>
          <input id="code" name="code" className="input" required inputMode="numeric" autoComplete="one-time-code" />
        </div>
        <button className="btn pri full" disabled={pending}>{pending ? "Verifying…" : "Verify"}</button>
      </form>
    );
  }

  if (!s.connected) {
    return (
      <form onSubmit={submit("login")} className="stack">
        {err}
        <div>
          <label className="lbl" htmlFor="g-email">Garmin email</label>
          <input id="g-email" name="email" type="email" className="input" required autoComplete="off" />
        </div>
        <div>
          <label className="lbl" htmlFor="g-password">Garmin password (used only to obtain a login token, never stored)</label>
          <input id="g-password" name="password" type="password" className="input" required autoComplete="off" />
        </div>
        <button className="btn pri full" disabled={pending}>{pending ? "Connecting… (may take half a minute)" : "Connect Garmin"}</button>
      </form>
    );
  }

  return (
    <div className="stack">
      {err}
      <div className="card" style={{ padding: "2px 14px" }}>
        <div className="line">
          <div>Sync</div>
          <div>{s.syncing ? "Syncing…" : s.last_sync ? `Last ${new Date(s.last_sync).toLocaleString()}` : "Pending"}</div>
        </div>
        <div className="line">
          <div>Data</div>
          <div>{s.days ? `${s.days} days (${s.first_day} to ${s.last_day}), ${s.activities} activities` : "None yet"}</div>
        </div>
        <div className="line">
          <div>Time zone</div>
          <div className="mono">{s.timezone}</div>
        </div>
      </div>
      <form onSubmit={submit("sync")} className="line" style={{ gap: 8, padding: 0, border: 0 }}>
        <input name="since" type="date" className="input" aria-label="Resync from this date (optional)" title="Resync from this date; leave empty to sync only the last few days" />
        <button className="btn sm" style={{ whiteSpace: "nowrap" }} disabled={pending || s.syncing}>Sync now</button>
      </form>
      <button
        className="btn sm danger"
        disabled={pending || s.syncing}
        onClick={() => confirm("After disconnecting you'll need to re-enter your Garmin email and password. Synced data is kept.") && act("disconnect")}
      >
        Disconnect Garmin
      </button>
    </div>
  );
}
