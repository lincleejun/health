import { headers } from "next/headers";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { ConsentForm } from "@/components/Consent";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/session";

export const instant = false;

// AI 助手请求连接时的授权页。链接里的参数由服务端签名，这里先验签再展示。
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const all = await searchParams;
  await requireUser();
  // 还原成原始查询串再验签：重复出现的参数要逐个放回去
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(all)) for (const one of [v].flat()) qs.append(k, one);
  const query = qs.toString();
  const params = { client_id: qs.get("client_id") ?? "", scope: qs.get("scope") ?? "" };
  const { secret } = await auth.$context;
  const valid = await verifyOAuthQueryParams(query, secret);
  let clientName = "一个 AI 助手";
  if (valid && params.client_id) {
    const client = await auth.api
      .getOAuthClientPublic({ query: { client_id: params.client_id }, headers: await headers() })
      .catch(() => null);
    clientName = client?.client_name || clientName;
  }

  return (
    <main className="auth">
      <h1>连接健康数据</h1>
      {valid ? (
        <>
          <p><b style={{ color: "var(--text)" }}>{clientName}</b> 想读取你的健康数据。它只能查询，不能修改；你可以随时在首页断开。</p>
          <ConsentForm requested={params.scope.split(" ").filter(Boolean)} />
        </>
      ) : (
        <div className="err">这个授权链接无效或已过期，请回到 AI 助手重新发起连接。</div>
      )}
    </main>
  );
}
