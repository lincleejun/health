"""个人健康数据库：同步 Garmin 到本地 Postgres，并以只读 MCP 提供给 agent。

uv run health.py init-db            建表/视图/只读账号（可重复运行）
uv run health.py garmin-login       首次登录（在你自己的终端里输入账号密码）
uv run health.py garmin-sync        增量同步；--since 2026-01-01 回补历史
uv run health.py mcp                stdio MCP 服务（只读）
"""

import argparse
import datetime as dt
import getpass
import json
import os
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parent
TOKENS = str(Path("~/.garminconnect").expanduser())

for line in (ROOT / ".env").read_text().splitlines() if (ROOT / ".env").exists() else []:
    k, _, v = line.partition("=")
    if k.strip() and not k.lstrip().startswith("#"):
        os.environ.setdefault(k.strip(), v.strip())

# DATABASE_URL / DATABASE_URL_RO 指向云端（Neon）；没设时用本机 Docker
DSN = os.environ.get("DATABASE_URL") or f"host=127.0.0.1 port=5433 dbname=health user=health password={os.environ.get('PGPASSWORD', '')}"
RO_DSN = os.environ.get("DATABASE_URL_RO") or f"host=127.0.0.1 port=5433 dbname=health user=health_ro password={os.environ.get('PG_RO_PASSWORD', '')}"
TZ = os.environ.get("HEALTH_TZ", "America/Los_Angeles")

# 每天拉取的指标：garminconnect 方法名去掉 get_
DAILY_METRICS = [
    "user_summary", "sleep_data", "heart_rates", "stress_data", "steps_data",
    "hrv_data", "respiration_data", "spo2_data", "training_readiness",
    "training_status", "max_metrics",
]
OVERLAP_DAYS = 2  # Garmin 当天/前一天的数据会在手表同步后被补全，每次重拉


def init_db():
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute((ROOT / "db/schema.sql").read_text())
        db = sql.Identifier(conn.info.dbname)
        conn.execute(sql.SQL("ALTER DATABASE {} SET timezone TO {}").format(db, TZ))
        # public 里有网页登录用的会话和令牌表，只读账号绝不能读到
        conn.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
        if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'health_ro'").fetchone():
            conn.execute("CREATE ROLE health_ro LOGIN")
        # 密码取自 RO_DSN，保证和 MCP / Vercel 用的只读连接串一致
        ro_password = psycopg.conninfo.conninfo_to_dict(RO_DSN)["password"]
        conn.execute(sql.SQL("ALTER ROLE health_ro PASSWORD {}").format(ro_password))
        conn.execute("ALTER ROLE health_ro SET default_transaction_read_only = on")
        conn.execute("ALTER ROLE health_ro SET statement_timeout = '30s'")
        for schema in ("garmin",):
            conn.execute(f"GRANT USAGE ON SCHEMA {schema} TO health_ro")
            conn.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA {schema} TO health_ro")
            conn.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} GRANT SELECT ON TABLES TO health_ro")
    print("数据库已就绪")


def garmin_login():
    from garminconnect import Garmin

    email = input("Garmin 邮箱: ")
    password = getpass.getpass("Garmin 密码: ")
    Garmin(email, password, prompt_mfa=lambda: input("MFA 验证码: ")).login(TOKENS)
    print(f"登录成功，token 已保存到 {TOKENS}")


def garmin_sync(since: str | None, backfill: int):
    from garminconnect import Garmin

    # token 存在数据库 public.garmin_token（只读账号读不到），本机和 GitHub Action 共用；
    # 库里还没有时用本机 garmin-login 生成的 ~/.garminconnect。续期后的 token 必须写回，否则下次登录失效。
    with psycopg.connect(DSN, autocommit=True) as conn:
        row = conn.execute("SELECT data FROM public.garmin_token WHERE id = 1").fetchone()
        api = Garmin()
        api.login(row[0] if row else TOKENS)

        def save_tokens():
            conn.execute(
                """INSERT INTO public.garmin_token (id, data) VALUES (1, %s)
                   ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()""",
                (api.client.dumps(),),
            )

        save_tokens()
        try:
            _garmin_sync(api, since, backfill)
        finally:
            save_tokens()


def _garmin_sync(api, since: str | None, backfill: int):
    from garminconnect import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError

    today = dt.datetime.now(ZoneInfo(TZ)).date()  # GitHub Action 跑在 UTC，按本人时区算“今天”
    with psycopg.connect(DSN) as conn:
        if since:
            start = dt.date.fromisoformat(since)
        else:
            # 手表可能几天后才同步：从近 14 天里最早一个还没有日常数据的日子重拉，否则重拉最近 OVERLAP_DAYS 天
            start = conn.execute(
                """SELECT least(min(day) FILTER (WHERE data->>'includesWellnessData' IS DISTINCT FROM 'true'
                                                   AND day >= current_date - 14),
                                max(day) - %s)
                     FROM garmin.daily WHERE metric = 'user_summary'""",
                (OVERLAP_DAYS,),
            ).fetchone()[0] or today - dt.timedelta(days=backfill)

        day = start
        while day <= today:
            ok = 0
            for metric in DAILY_METRICS:
                try:
                    data = getattr(api, f"get_{metric}")(day.isoformat())
                except (GarminConnectAuthenticationError, GarminConnectTooManyRequestsError):
                    raise  # 认证失效或被限流：停下来，已写入的保留，下次从断点继续
                except Exception as e:
                    print(f"  {day} {metric}: {type(e).__name__}: {e}", file=sys.stderr)
                    continue
                if data is None:
                    continue
                conn.execute(
                    """INSERT INTO garmin.daily (metric, day, data) VALUES (%s, %s, %s)
                       ON CONFLICT (metric, day) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()""",
                    (metric, day, Jsonb(data)),
                )
                ok += 1
            conn.commit()  # 按天提交，中断不丢已拉的天
            print(f"{day}: {ok}/{len(DAILY_METRICS)}")
            day += dt.timedelta(days=1)
            time.sleep(0.5)  # ponytail: 固定节流，被限流再调大

        acts = api.get_activities_by_date(start.isoformat(), today.isoformat())
        for a in acts:
            conn.execute(
                """INSERT INTO garmin.activity (id, start_time, data) VALUES (%s, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET start_time = EXCLUDED.start_time, data = EXCLUDED.data, fetched_at = now()""",
                (a["activityId"], a.get("startTimeGMT") and a["startTimeGMT"] + "+00", Jsonb(a)),
            )
        conn.commit()
        print(f"运动记录: {len(acts)}")


def mcp_server():
    from mcp.server.mcpserver import MCPServer
    from mcp.server.mcpserver.exceptions import ToolError

    server = MCPServer("health", instructions=(ROOT / "skills/health/SKILL.md").read_text())

    @server.tool()
    def schema() -> str:
        """列出所有可查询的表/视图、列和说明。先调用它再写 SQL。"""
        with psycopg.connect(RO_DSN) as conn:
            rows = conn.execute(
                """SELECT c.table_schema || '.' || c.table_name, obj_description((c.table_schema || '.' || c.table_name)::regclass),
                          string_agg(c.column_name || ' ' || c.data_type, ', ' ORDER BY c.ordinal_position)
                     FROM information_schema.columns c
                    WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
                    GROUP BY 1, 2 ORDER BY 1"""
            ).fetchall()
        return "\n".join(f"{t}  -- {d or ''}\n  {cols}" for t, d, cols in rows)

    @server.tool()
    def query(sql: str, limit: int = 500) -> str:
        """在健康数据库上执行只读 SQL（Postgres），返回 JSON 行。最多返回 limit 行。"""
        with psycopg.connect(RO_DSN) as conn:
            try:
                cur = conn.execute(sql)
            except psycopg.Error as e:
                raise ToolError(str(e)) from e  # 把 Postgres 报错原文交给 agent，便于它改 SQL
            cols = [c.name for c in cur.description or []]
            rows = cur.fetchmany(limit)
        return json.dumps([dict(zip(cols, r)) for r in rows], ensure_ascii=False, default=str)

    server.run()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    sub.add_parser("garmin-login")
    s = sub.add_parser("garmin-sync")
    s.add_argument("--since", help="从这一天开始重拉，YYYY-MM-DD")
    s.add_argument("--backfill", type=int, default=30, help="首次同步回溯天数")
    sub.add_parser("mcp")
    a = p.parse_args()
    {"init-db": init_db, "garmin-login": garmin_login, "mcp": mcp_server,
     "garmin-sync": lambda: garmin_sync(a.since, a.backfill)}[a.cmd]()
