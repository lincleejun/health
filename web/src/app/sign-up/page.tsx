import Link from "next/link";
import { AuthForm } from "@/components/Account";

export default function Page() {
  return (
    <main className="auth">
      <h1>健康数据</h1>
      <p>只有第一个注册的账号有效，之后注册会关闭。</p>
      <AuthForm mode="sign-up" />
      <p style={{ marginTop: 16 }}>
        <Link href="/sign-in">已有账号，去登录</Link>
      </p>
    </main>
  );
}
