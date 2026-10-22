# Install guide (for coding agents)

You are installing **health**, a self-hosted Garmin → Postgres → read-only MCP server, for the user on this machine. Follow the steps in order and run each check. Stop and report to the user if a step cannot be completed.

Rules:
- Never ask for, type, or store the user's Garmin password. The user enters it in the browser.
- Never run `docker compose down -v` or delete Docker volumes unless the user explicitly asks; that erases all health data.
- No configuration is required. Only create a `.env` file if a step below says so.

## 1. Check prerequisites

```bash
git --version
docker --version
docker compose version     # must be Compose v2 ("docker compose", not "docker-compose")
docker info --format '{{.ServerVersion}}'   # must print a version: the daemon is running
```

- If Docker is missing, tell the user to install Docker Desktop (macOS/Windows), OrbStack (macOS), or Docker Engine + Compose plugin (Linux), then stop.
- If `docker info` fails, the daemon isn't running. On macOS, run `open -a Docker` (or `open -a OrbStack`), wait until `docker info` succeeds, and retry.

## 2. Get the code

If the current directory is not already this repository, clone it:

```bash
git clone https://github.com/lincleejun/health.git && cd health
```

All later commands run from the repository root (the folder containing `docker-compose.yml`).

## 3. Pick a port

The app listens on `127.0.0.1:3000` by default. Check whether the port is free:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN || echo free
```

If it is taken, pick a free port (for example 3001) and write it to `.env` in the repository root:

```bash
echo "HEALTH_PORT=3001" >> .env
```

Use that port instead of 3000 everywhere below.

## 4. Start

```bash
docker compose up -d --build --wait
```

`--wait` returns only after every service is healthy, and exits non-zero if one fails (see Troubleshooting). The first run builds two images and takes a few minutes. Build output may contain `ECONNREFUSED` errors while the web app compiles. They are expected (there is no database at build time) and can be ignored as long as the command exits 0.

## 5. Verify

```bash
docker compose ps -a
```

Expected: `db`, `worker`, and `web` show `(healthy)`; `secrets` shows `Exited (0)` (it only generates passwords on first start).

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:3000/sign-in           # expect 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/mcp     # expect 401 (MCP is up and requires a token)
docker compose logs worker | grep -m1 "Worker started"
```

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `docker compose up` hangs on pulling images, or prints `error getting credentials` | The Docker credential helper is stuck. In `~/.docker/config.json`, change `"credsStore": "desktop"` to `"credsStore": "osxkeychain"` (macOS), or delete that line, after backing the file up. Retry. |
| `port is already allocated` | Go back to step 3 and choose another port. |
| `up --wait` exits non-zero, or a service is not `(healthy)` | Run `docker compose logs <service>` (e.g. `worker`, `db`, `web`), fix what it reports, then rerun `docker compose up -d --wait`. |
| Sign-in or sign-up fails with `Invalid origin`, or OAuth errors | The URL in the browser must match `PUBLIC_URL` (default `http://localhost:<port>`). Use `localhost`, not `127.0.0.1` or a LAN IP; to use another address, set `PUBLIC_URL` to it and rerun `docker compose up -d`. |

## 7. Hand off to the user

Tell the user to open `http://localhost:3000` (or their port) and:

1. **Sign up.** The first account is the owner, and sign-up closes afterwards.
2. **Connect Garmin** with their Garmin email and password, plus a 2FA code if asked. The first sync backfills 30 days in the background; its progress shows on the page.
3. **Create an access token** under "Local agent access tokens". The page shows a ready-made `claude mcp add …` command.

If the user pastes that command or the token back to you, you may register the MCP server for them. For Claude Code:

```bash
claude mcp add --transport http health http://localhost:3000/api/mcp --header "Authorization: Bearer <token>"
```

Otherwise, a stdio setup works without a token:

```bash
claude mcp add health -- docker compose -f "$(pwd)/docker-compose.yml" exec -T worker entrypoint.sh python health.py mcp
```

Verify by asking the assistant to call the `schema` tool from the `health` MCP server.

## 8. Optional: ChatGPT / Claude.ai

These connect from the internet and need a public HTTPS URL that forwards to the local port (reverse proxy, Cloudflare Tunnel, Tailscale Funnel). Once the user has one:

```bash
echo "PUBLIC_URL=https://their-domain.example" >> .env
docker compose up -d
```

Then, in ChatGPT (Settings → Apps & Connectors) or Claude.ai (Settings → Connectors), add a custom MCP server at `https://their-domain.example/api/mcp` with OAuth.

## Maintenance

```bash
git pull && docker compose up -d --build                        # update
docker compose logs -f worker                                   # sync logs
docker compose exec db pg_dump -U health health > backup.sql    # backup
docker compose down                                             # stop; data is kept
```
