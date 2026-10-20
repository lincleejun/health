import Link from "next/link";
import { AuthForm } from "@/components/Account";

export default function Page() {
  return (
    <main className="auth">
      <h1>健康数据</h1>
      <p>登录后，AI 助手才能连接你的健康数据。</p>
      <AuthForm mode="sign-in" />
      <p style={{ marginTop: 16 }}>
        <Link href="/sign-up">第一次使用，去注册</Link>
      </p>
    </main>
  );
}
