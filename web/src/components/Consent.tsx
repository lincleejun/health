"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

const LABELS: Record<string, { title: string; note: string }> = {
  "health:read": { title: "View health data", note: "Read-only access to heart rate, sleep, stress, steps, workouts, and other records" },
};

export function ConsentForm({ requested }: { requested: string[] }) {
  const ours = requested.filter((s) => s in LABELS);
  const base = requested.filter((s) => !(s in LABELS));
  // Only "view" is checked by default; the user decides on the rest
  const [granted, setGranted] = useState(() => new Set<string>(ours.filter((s) => s === "health:read")));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function answer(accept: boolean) {
    setPending(true);
    const res = await authClient.oauth2.consent({ accept, scope: accept ? [...base, ...granted].join(" ") : undefined });
    const next = res.data as { url?: string; redirect_uri?: string } | null;
    const url = next?.url ?? next?.redirect_uri;
    if (res.error || !url) {
      setPending(false);
      return setError(res.error?.message ?? "Authorization didn't complete. Go back to your AI assistant and connect again");
    }
    window.location.assign(url);
  }

  return (
    <div className="stack">
      {error && <div className="err" role="alert">{error}</div>}
      <div className="card" style={{ padding: "2px 14px" }}>
        {ours.map((s) => (
          <label className="line" key={s} style={{ cursor: "pointer" }}>
            <div>{LABELS[s].title}<small>{LABELS[s].note}</small></div>
            <input
              type="checkbox"
              checked={granted.has(s)}
              onChange={(e) => setGranted((g) => { const n = new Set(g); if (e.target.checked) n.add(s); else n.delete(s); return n; })}
              style={{ width: 20, height: 20 }}
            />
          </label>
        ))}
      </div>
      <div className="two">
        <button className="btn" disabled={pending} onClick={() => answer(false)}>Deny</button>
        <button className="btn pri" disabled={pending || granted.size === 0} onClick={() => answer(true)}>Allow</button>
      </div>
    </div>
  );
}
