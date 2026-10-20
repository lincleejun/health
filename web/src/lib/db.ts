import { Pool, types } from "pg";

// 两个连接池：owner 给 Better Auth（用户、会话、令牌表在 public）；
// health_ro 给 MCP 的 query 工具，只能读 garmin 等数据 schema，读不到 public 里的令牌。
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

// 只对只读池：date / timestamp / timestamptz 原样返回 Postgres 的字符串（带本地时区偏移），
// 否则 2026-10-19 会变成 2026-10-19T07:00:00.000Z，AI 容易读错。
// 不能用全局 types.setTypeParser：Better Auth 需要 Date 对象。
const RAW = new Set([1082, 1114, 1184]);
export const roPool = new Pool({
  connectionString: process.env.DATABASE_URL_RO,
  max: 3,
  types: {
    getTypeParser: ((oid: number, format?: "text" | "binary") =>
      RAW.has(oid) ? (v: string) => v : types.getTypeParser(oid, format)) as typeof types.getTypeParser,
  },
});
