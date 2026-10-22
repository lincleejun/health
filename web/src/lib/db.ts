import { Pool, types } from "pg";

// Two pools: owner for Better Auth (user, session, and token tables live in public);
// health_ro for the MCP query tool, which can read only data schemas like garmin, not the tokens in public.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

// Read-only pool only: return date / timestamp / timestamptz as Postgres's raw strings (with local UTC offset);
// otherwise 2026-10-19 becomes 2026-10-19T07:00:00.000Z and the AI easily misreads it.
// Can't use the global types.setTypeParser: Better Auth needs Date objects.
const RAW = new Set([1082, 1114, 1184]);
export const roPool = new Pool({
  connectionString: process.env.DATABASE_URL_RO,
  max: 3,
  types: {
    getTypeParser: ((oid: number, format?: "text" | "binary") =>
      RAW.has(oid) ? (v: string) => v : types.getTypeParser(oid, format)) as typeof types.getTypeParser,
  },
});
