import { SignOut, Tokens } from "@/components/Account";
import { requireUser } from "@/lib/session";

// 依赖登录态，不预渲染
export const instant = false;

export default async function Home() {
  const user = await requireUser();
  return (
    <main className="auth">
      <h1>健康数据</h1>
      <p>已登录：{user.email}。ChatGPT、Claude 添加 MCP 服务时填 <span className="mono">/api/mcp</span> 的完整地址，按提示登录授权即可。</p>
      <div className="sect">本地 agent 访问令牌</div>
      <div className="card" style={{ padding: "2px 14px", marginTop: 6 }}>
        <Tokens />
      </div>
      <div style={{ marginTop: 16 }}><SignOut /></div>
    </main>
  );
}
