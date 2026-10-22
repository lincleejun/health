// Better Auth tables (user, session, apikey, oauth…) live in public; the health data schemas and read-only role are handled by ../health.py init-db. Safe to rerun.
import { execSync } from "node:child_process";

execSync("npx auth@latest migrate --yes", { stdio: "inherit" });
console.log("Auth tables are ready");
