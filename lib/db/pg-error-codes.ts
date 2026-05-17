/**
 * Postgres error codes (SQLSTATE) that la app verifica explícitamente al
 * recibir errores de Supabase. Centralizado para evitar las 12+ copias
 * verbatim de `const UNIQUE_VIOLATION = "23505"` que vivían en cada
 * archivo de actions.
 *
 * Lista completa: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
