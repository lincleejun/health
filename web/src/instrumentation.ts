// The Docker image sets AUTO_MIGRATE=1: create the auth tables before the server starts, so it works out of the box.
// Vercel deploys leave it unset and migrate manually with npm run db:init, so cold starts don't re-check the schema.
// Dynamic import: instrumentation is also bundled for the edge runtime, so Node modules like pg may only load in the nodejs branch (as the Next docs do).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.AUTO_MIGRATE !== "1") return;
  const { getMigrations } = await import("better-auth/db/migration");
  const { auth } = await import("@/lib/auth");
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
