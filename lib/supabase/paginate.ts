// Drains PostgREST queries past the server's `max_rows` cap
// (supabase/config.toml `max_rows = 1000`). PostgREST silently truncates any
// response at that cap, even when `.range()` asks for more, so any read whose
// result can grow with the data (statements, books, exports, aggregates summed
// in JS) must be fetched page by page.
//
// Contract for callers of `paginateRange`: the query MUST carry a deterministic
// TOTAL order (end with a unique column, e.g. `.order("id")`). OFFSET pages over
// a partial order (e.g. `fecha` alone) can repeat or skip rows at page
// boundaries, which for money totals is a silent wrong number.
//
// Errors are returned, not thrown, so server actions keep returning
// `ActionResult` without try/catch.

/** Must equal the server's `max_rows`: a full page then means "maybe more",
 *  never "capped partial page that ends the loop early". */
export const PAGE_SIZE = 1000;

/** Default chunk for `.in(column, ids)` filters: keeps the GET URL well under
 *  proxy/PostgREST limits (36-char uuids → ~8 KB per 200 ids). */
export const IN_CHUNK_SIZE = 200;

export type PageError = {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type Page<T> = { data: T[] | null; error: PageError | null };

export type DrainResult<T> =
  | { data: T[]; error: null }
  | { data: null; error: PageError };

/**
 * Fetches `[from, to]` windows until a short page signals the end.
 * `fetchPage` must build a FRESH query each call (builders are mutable) and
 * apply `.range(from, to)` on a totally ordered query.
 */
export async function paginateRange<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<DrainResult<T>> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const page = data ?? [];
    for (const row of page) rows.push(row);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return { data: rows, error: null };
}

/** Splits `items` into consecutive slices of at most `size` (size ≥ 1). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk: invalid size ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Runs `fetchChunk` for each slice of `ids` (in parallel) and concatenates the
 * rows in chunk order. The first error (in chunk order) is returned and the
 * rows are discarded — a partial lookup must not pass for a complete one.
 * Each chunk's own result is drained with `paginateRange` by the caller when
 * one id can match many rows; for 1:1 lookups a chunk of 200 ids returns at
 * most 200 rows, below the cap.
 */
export async function fetchInChunks<Id, T>(
  ids: readonly Id[],
  fetchChunk: (ids: Id[]) => PromiseLike<Page<T>>,
  size: number = IN_CHUNK_SIZE,
): Promise<DrainResult<T>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { data: [], error: null };
  const results = await Promise.all(chunk(unique, size).map(fetchChunk));
  const rows: T[] = [];
  for (const res of results) {
    if (res.error) return { data: null, error: res.error };
    for (const row of res.data ?? []) rows.push(row);
  }
  return { data: rows, error: null };
}
