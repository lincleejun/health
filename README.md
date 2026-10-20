# health

个人健康数据库：可穿戴设备数据 → 云端 Postgres（Neon）→ 只读 MCP，给 ChatGPT / Codex / Claude 做分析。

```
Mac launchd 每小时 ──garmin-sync──▶ Neon Postgres ◀──只读── web/（Vercel，/api/mcp，OAuth）◀── ChatGPT / Claude
                                        ▲
                                        └──只读── health.py mcp（stdio）◀── Codex / Claude Code
```

- 网页与云端 MCP：https://health-gules-omega.vercel.app ，代码在 `web/`（Next.js + Better Auth，做法同 medcabin）。
- 查询随时可用；数据新鲜度取决于 Mac 是否开机（Garmin 同步跑在本机）。
- 本机 Docker Postgres（`docker-compose.yml`）保留作离线备份/开发用；`.env` 里设了 `DATABASE_URL` 就走 Neon。

现在接入：Garmin（`python-garminconnect`，非官方接口）。计划：Oura（官方 OAuth，PAT 已于 2025-12 停用）、饮食。

## 起步

```bash
docker compose up -d          # Postgres 17，127.0.0.1:5433，数据在 volume pgdata
uv run health.py init-db      # 建表/视图/只读账号，可重复运行
uv run health.py garmin-login # 一次即可，token 存在 ~/.garminconnect
uv run health.py garmin-sync --since 2025-01-01   # 回补历史
```

`.env`（已 gitignore）：`PGPASSWORD`、`PG_RO_PASSWORD`、`HEALTH_TZ`。

## 定时同步

每小时一次，重拉最近 2 天（Garmin 会补全数据），日志在 `sync.log`：

```bash
ln -sf "$PWD/launchd/cc.outman.health-sync.plist" ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/cc.outman.health-sync.plist
```

同步写入 Neon，不再依赖 Docker；只要 Mac 开机联网就会同步。

## 数据

- 原始响应：`garmin.daily(metric, day, data jsonb)`、`garmin.activity(id, start_time, data jsonb)`
- 分析视图：`garmin.day` / `garmin.halfday` / `garmin.hourly` / `garmin.sample` / `garmin.activities`
- 结构在 `db/schema.sql`；给 agent 的说明在 `skills/health/SKILL.md`

## 接入 ChatGPT

1. 先打开网页注册（只有第一个账号有效，之后自动关闭注册）。
2. ChatGPT → Plugins（或 设置 → 应用与连接器）→ “+” → Add custom MCP server。
3. Connection 选公网地址：`https://health-gules-omega.vercel.app/api/mcp`，认证选 OAuth（动态注册），确认风险提示，Create。
4. 跳到登录页登录 → 授权页勾选“查看健康数据” → 允许。之后在对话里 @ 它提问。

Claude.ai 同理：设置 → Connectors → 添加自定义连接器，填同一个地址。

## 接入本地 agent

MCP（stdio，用只读账号 `health_ro`，数据库层禁止写入）：工具 `schema()`、`query(sql)`。

- Codex：`~/.codex/config.toml` 里 `[mcp_servers.health]`
- Claude Code：`claude mcp add -s user health -- uv --directory <本目录> run health.py mcp`

也可以走云端 MCP：在网页首页新建访问令牌，`claude mcp add --transport http health https://health-gules-omega.vercel.app/api/mcp --header "Authorization: Bearer <令牌>"`。
