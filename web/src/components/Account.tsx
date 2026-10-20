"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
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
    if (res.error) return setError(res.error.message ?? "出错了，请再试一次");
    // 从 AI 助手的授权流程跳过来登录时，登录后要回到授权流程
    const next = res.data as { redirect?: boolean; url?: string } | null;
    if (next?.redirect && next.url) return window.location.assign(next.url);
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="stack">
      {error && <div className="err" role="alert">{error}</div>}
      {mode === "sign-up" && <div><label className="lbl" htmlFor="name">称呼</label><input id="name" name="name" className="input" required autoComplete="name" /></div>}
      <div><label className="lbl" htmlFor="email">邮箱</label><input id="email" name="email" type="email" className="input" required autoComplete="email" /></div>
      <div><label className="lbl" htmlFor="password">密码{mode === "sign-up" && "（至少 10 位）"}</label><input id="password" name="password" type="password" className="input" required minLength={mode === "sign-up" ? 10 : undefined} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} /></div>
      <button className="btn pri full" disabled={pending}>{mode === "sign-in" ? "登录" : "注册"}</button>
    </form>
  );
}

export function SignOut() {
  const router = useRouter();
  return (
    <button className="btn full" onClick={async () => { await authClient.signOut(); router.push("/sign-in"); router.refresh(); }}>
      退出登录
    </button>
  );
}

type Key = { id: string; name: string | null; start: string | null; createdAt: Date | string };

// 给本地 AI agent 用的访问令牌。明文只在创建时显示一次。
export function Tokens() {
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
    const name = String(new FormData(e.currentTarget).get("name") || "AI 助手");
    const res = await authClient.apiKey.create({ name });
    if (res.error) return setError(res.error.message ?? "创建失败");
    setFresh(res.data.key);
    e.currentTarget?.reset();
    load();
  }

  return (
    <>
      {keys.map((k) => (
        <div className="line" key={k.id}>
          <div>{k.name ?? "未命名"}<small className="mono">{k.start}…</small></div>
          <button className="btn sm danger" onClick={async () => { await authClient.apiKey.delete({ keyId: k.id }); load(); }}>断开</button>
        </div>
      ))}
      <form onSubmit={create} className="line" style={{ gap: 8 }}>
        <input name="name" className="input" placeholder="令牌用途，例如 Claude Code" aria-label="令牌名称" />
        <button className="btn sm" style={{ whiteSpace: "nowrap" }}>新建令牌</button>
      </form>
      {fresh && <div className="okmsg" style={{ marginBottom: 12 }}>请现在复制，之后不会再显示：<br /><span className="mono">{fresh}</span></div>}
      {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}
    </>
  );
}
