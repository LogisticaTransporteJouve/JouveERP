/**
 * Postgres error codes (SQLSTATE) that the app checks explicitly when
 * handling errors from Supabase. Centralized to avoid the 12+ verbatim
 * copies of `const UNIQUE_VIOLATION = "23505"` that used to live in every
 * actions file.
 *
 * Full list: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
