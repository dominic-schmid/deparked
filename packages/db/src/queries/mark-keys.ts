import { gte, lt, type SQL, sql } from "drizzle-orm";
import { rateLimits } from "../schema";

// Not re-exported from `index.ts`: the query modules share it, callers use `marks.ts`.
export const MARK_PREFIX = "mark:";
/** The key range of every workspace mark. ";" is the character after ":". */
export const isMark: SQL = sql`(${gte(rateLimits.key, MARK_PREFIX)} and ${lt(rateLimits.key, "mark;")})`;
