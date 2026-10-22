"""Personal health database: syncs Garmin into Postgres and exposes it to agents via a read-only MCP.

uv run health.py init-db            create tables/views/read-only role (idempotent)
uv run health.py garmin-login       log in to Garmin in the terminal; token is stored in the database
uv run health.py garmin-sync        incremental sync; --since 2026-01-01 to backfill history
uv run health.py mcp                stdio MCP server (read-only)
uv run health.py serve              background service in Docker: scheduled sync plus the Garmin login API for the web app
"""

import argparse
import contextlib
import datetime as dt
import getpass
import json
import os
import sys
import threading
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parent

for line in (ROOT / ".env").read_text().splitlines() if (ROOT / ".env").exists() else []:
    k, _, v = line.partition("=")
    if k.strip() and not k.lstrip().startswith("#"):
        os.environ.setdefault(k.strip(), v.strip())

# DATABASE_URL is the owner (DDL, sync writes); DATABASE_URL_RO is the read-only role health_ro (MCP queries)
DSN = os.environ.get("DATABASE_URL")
RO_DSN = os.environ.get("DATABASE_URL_RO")

# Metrics fetched daily: garminconnect method names without the get_ prefix
DAILY_METRICS = [
    "user_summary", "sleep_data", "heart_rates", "stress_data", "steps_data",
    "hrv_data", "respiration_data", "spo2_data", "training_readiness",
    "training_status", "max_metrics",
]
OVERLAP_DAYS = 2  # Garmin fills in today/yesterday after the watch syncs, so always re-fetch them
BACKFILL_DAYS = 30  # days to look back on the first sync


def init_db():
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute((ROOT / "db/schema.sql").read_text())
        if tz := os.environ.get("HEALTH_TZ"):
            set_timezone(conn, tz)
        # public holds the web app's session and token tables; the read-only role must never see them
        conn.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
        if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'health_ro'").fetchone():
            conn.execute("CREATE ROLE health_ro LOGIN")
        # password comes from RO_DSN so it matches the read-only DSN used by MCP / the web app
        ro_password = psycopg.conninfo.conninfo_to_dict(RO_DSN)["password"]
        conn.execute(sql.SQL("ALTER ROLE health_ro PASSWORD {}").format(ro_password))
        conn.execute("ALTER ROLE health_ro SET default_transaction_read_only = on")
        conn.execute("ALTER ROLE health_ro SET statement_timeout = '30s'")
        for schema in ("garmin",):
            conn.execute(f"GRANT USAGE ON SCHEMA {schema} TO health_ro")
            conn.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA {schema} TO health_ro")
            conn.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} GRANT SELECT ON TABLES TO health_ro")
    print("Database ready")


def set_timezone(conn, tz: str):
    """The database timezone defines "which day" and "what hour" in the views, and "today" during sync. Applies to new connections."""
    ZoneInfo(tz)  # unknown timezone names fail here
    db = sql.Identifier(conn.info.dbname)
    conn.execute(sql.SQL("ALTER DATABASE {} SET timezone TO {}").format(db, tz))


# The Garmin token (incl. refresh token) lives in public.garmin_token, out of reach of the read-only role.
# Every login refreshes it; the refreshed token must be written back or the next login fails.
def load_token(conn) -> str | None:
    row = conn.execute("SELECT data FROM public.garmin_token WHERE id = 1").fetchone()
    return row[0] if row else None


def save_token(conn, api):
    conn.execute(
        """INSERT INTO public.garmin_token (id, data) VALUES (1, %s)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()""",
        (api.client.dumps(),),
    )


def garmin_login():
    from garminconnect import Garmin

    email = input("Garmin email: ")
    password = getpass.getpass("Garmin password: ")
    api = Garmin(email, password, prompt_mfa=lambda: input("MFA code: "))
    api.login()
    with psycopg.connect(DSN, autocommit=True) as conn:
        save_token(conn, api)
    print("Logged in; token saved to the database")


def garmin_sync(since: str | None, backfill: int):
    from garminconnect import Garmin

    with psycopg.connect(DSN, autocommit=True) as conn:
        token = load_token(conn)
        if not token:
            raise RuntimeError("Garmin is not connected yet: connect it in the web app, or run garmin-login")
        api = Garmin()
        api.login(token)
        save_token(conn, api)
        try:
            _garmin_sync(api, since, backfill)
        finally:
            save_token(conn, api)


def _garmin_sync(api, since: str | None, backfill: int):
    from garminconnect import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError

    with psycopg.connect(DSN) as conn:
        today = conn.execute("SELECT current_date").fetchone()[0]  # "today" in the database timezone
        if since:
            start = dt.date.fromisoformat(since)
        else:
            # The watch may sync days late: re-fetch from the earliest day in the last 14 with no daily data, otherwise the last OVERLAP_DAYS days
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
                    raise  # auth expired or rate-limited: stop, keep what's written, resume from here next time
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
            conn.commit()  # commit per day so an interruption keeps the days already fetched
            print(f"{day}: {ok}/{len(DAILY_METRICS)}")
            day += dt.timedelta(days=1)
            time.sleep(0.5)  # ponytail: fixed throttle; raise it if we get rate-limited

        acts = api.get_activities_by_date(start.isoformat(), today.isoformat())
        for a in acts:
            conn.execute(
                """INSERT INTO garmin.activity (id, start_time, data) VALUES (%s, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET start_time = EXCLUDED.start_time, data = EXCLUDED.data, fetched_at = now()""",
                (a["activityId"], a.get("startTimeGMT") and a["startTimeGMT"] + "+00", Jsonb(a)),
            )
        conn.commit()
        print(f"Activities: {len(acts)}")


def mcp_server():
    from mcp.server.mcpserver import MCPServer
    from mcp.server.mcpserver.exceptions import ToolError

    server = MCPServer("health", instructions=(ROOT / "skills/health/SKILL.md").read_text())

    @server.tool()
    def schema() -> str:
        """List all queryable tables/views with their columns and descriptions. Call this before writing SQL."""
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
        """Run read-only SQL (Postgres) against the health database and return rows as JSON. Returns at most limit rows."""
        with psycopg.connect(RO_DSN) as conn:
            try:
                cur = conn.execute(sql)
            except psycopg.Error as e:
                raise ToolError(str(e)) from e  # pass the raw Postgres error to the agent so it can fix its SQL
            cols = [c.name for c in cur.description or []]
            rows = cur.fetchmany(limit)
        return json.dumps([dict(zip(cols, r)) for r in rows], ensure_ascii=False, default=str)

    server.run()


class Busy(Exception):
    pass


def serve(port: int = 8000):
    """Worker in Docker: syncs every SYNC_INTERVAL_HOURS and serves a JSON API to the web app on internal :8000
    (the web app checks auth before proxying; the port is not published)."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from garminconnect import Garmin, GarminConnectAuthenticationError

    every = float(os.environ.get("SYNC_INTERVAL_HOURS") or 6) * 3600
    init_db()
    lock = threading.Lock()  # login and sync both rewrite the token; only one at a time
    state = {"syncing": False, "last_sync": None, "error": None, "last_try": 0.0}
    pending = {}  # the login awaiting an MFA code

    def connected() -> bool:
        with psycopg.connect(DSN) as conn:
            return load_token(conn) is not None

    def start_sync(since: str | None = None):
        if not lock.acquire(blocking=False):
            raise Busy("A sync or login is in progress; please try again shortly")
        state.update(syncing=True, error=None, last_try=time.time())

        def run():
            try:
                garmin_sync(since, BACKFILL_DAYS)
            except GarminConnectAuthenticationError as e:
                state["error"] = f"Garmin login has expired; disconnect and reconnect. {e}"
            except Exception as e:
                state["error"] = f"{type(e).__name__}: {e}"
            finally:
                if state["error"]:
                    print(f"Sync failed: {state['error']}", file=sys.stderr)
                state.update(syncing=False, last_sync=dt.datetime.now(dt.UTC).isoformat())
                lock.release()

        threading.Thread(target=run, daemon=True).start()

    def finish_login(api, tz: str | None):
        with psycopg.connect(DSN, autocommit=True) as conn:
            save_token(conn, api)
            if tz:
                set_timezone(conn, tz)

    # ---- API ----
    def status(_):
        with psycopg.connect(DSN) as conn:
            days, first, last = conn.execute(
                "SELECT count(*), min(day), max(day) FROM garmin.daily WHERE metric = 'user_summary'"
            ).fetchone()
            return {
                "connected": load_token(conn) is not None,
                "mfa": "api" in pending,
                "syncing": state["syncing"],
                "last_sync": state["last_sync"],
                "error": state["error"],
                "days": days,
                "first_day": first and first.isoformat(),
                "last_day": last and last.isoformat(),
                "activities": conn.execute("SELECT count(*) FROM garmin.activity").fetchone()[0],
                "timezone": conn.execute("SHOW timezone").fetchone()[0],
            }

    def login(body):
        if not lock.acquire(blocking=False):
            raise Busy("A sync is in progress; please try again shortly")
        try:
            pending.clear()
            api = Garmin(body.get("email", ""), body.get("password", ""), return_on_mfa=True)
            if api.login()[0] == "needs_mfa":
                pending.update(api=api, tz=body.get("timezone"))
                return {"mfa": True}
            finish_login(api, body.get("timezone"))
        finally:
            lock.release()
        with contextlib.suppress(Busy):  # fine if a scheduled sync happened to start first
            start_sync()
        return {"ok": True}

    def mfa(body):
        if "api" not in pending:
            raise ValueError("Login session expired; please enter your email and password again")
        if not lock.acquire(blocking=False):
            raise Busy("A sync is in progress; please try again shortly")
        try:
            pending["api"].resume_login(None, str(body.get("code", "")).strip())  # a wrong code can be retried
            finish_login(pending["api"], pending["tz"])
            pending.clear()
        finally:
            lock.release()
        with contextlib.suppress(Busy):
            start_sync()
        return {"ok": True}

    def sync_now(body):
        if since := body.get("since"):
            dt.date.fromisoformat(since)
        if not connected():
            raise ValueError("Garmin is not connected yet")
        start_sync(since)
        return {"ok": True}

    def disconnect(_):
        if not lock.acquire(blocking=False):
            raise Busy("A sync is in progress; please try again shortly")
        try:
            with psycopg.connect(DSN, autocommit=True) as conn:
                conn.execute("DELETE FROM public.garmin_token")
            pending.clear()
            state["error"] = None
        finally:
            lock.release()
        return {"ok": True}

    routes = {
        ("GET", "/status"): status,
        ("POST", "/login"): login,
        ("POST", "/mfa"): mfa,
        ("POST", "/sync"): sync_now,
        ("POST", "/disconnect"): disconnect,
    }

    class Handler(BaseHTTPRequestHandler):
        def handle_one(self, method):
            if self.path == "/health":
                return self.reply(200, {"ok": True})
            fn = routes.get((method, self.path))
            if not fn:
                return self.reply(404, {"error": "not found"})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                self.reply(200, fn(body))
            except Busy as e:
                self.reply(409, {"error": str(e)})
            except Exception as e:
                self.reply(400, {"error": str(e) or type(e).__name__})

        def do_GET(self):
            self.handle_one("GET")

        def do_POST(self):
            self.handle_one("POST")

        def reply(self, code, data):
            payload = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass  # the web app polls /status every few seconds; keep it out of the log

    def scheduler():
        while True:
            try:
                if time.time() - state["last_try"] >= every and connected():
                    start_sync()
            except Busy:
                pass
            except Exception as e:
                print(f"Scheduled sync check failed: {e}", file=sys.stderr)
            time.sleep(60)

    threading.Thread(target=scheduler, daemon=True).start()
    print(f"Worker started on :{port}, syncing every {every / 3600:g} hours")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    sub.add_parser("garmin-login")
    s = sub.add_parser("garmin-sync")
    s.add_argument("--since", help="re-fetch starting from this date, YYYY-MM-DD")
    s.add_argument("--backfill", type=int, default=BACKFILL_DAYS, help="days to look back on the first sync")
    sub.add_parser("mcp")
    sub.add_parser("serve")
    a = p.parse_args()

    needs = {"init-db": ("DATABASE_URL", "DATABASE_URL_RO"), "mcp": ("DATABASE_URL_RO",),
             "serve": ("DATABASE_URL", "DATABASE_URL_RO")}.get(a.cmd, ("DATABASE_URL",))
    if missing := [n for n in needs if not os.environ.get(n)]:
        sys.exit(f"Missing environment variables {', '.join(missing)}: add them to .env, or just run with docker compose")
    try:
        {"init-db": init_db, "garmin-login": garmin_login, "mcp": mcp_server, "serve": serve,
         "garmin-sync": lambda: garmin_sync(a.since, a.backfill)}[a.cmd]()
    except RuntimeError as e:
        sys.exit(str(e))
