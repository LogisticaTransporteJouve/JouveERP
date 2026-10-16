// A fake RLS client for unit tests of reads that drain past PostgREST's
// max_rows: every query on a table resolves to that table's rows, and
// `.range(from, to)` serves at most `maxRows` of them, the way PostgREST
// silently caps a response. Filters are accepted and ignored.

type Row = Record<string, unknown>;

export const FAKE_MAX_ROWS = 1000;

export function pagedSupabase(
  tables: Record<string, Row[]>,
  options: { maxRows?: number; failOn?: string } = {},
) {
  const maxRows = options.maxRows ?? FAKE_MAX_ROWS;
  const calls: { table: string; from: number | null }[] = [];

  function query(table: string) {
    const rows = tables[table] ?? [];
    let window: [number, number] | null = null;
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      lt: () => builder,
      in: () => builder,
      or: () => builder,
      order: () => builder,
      range: (from: number, to: number) => {
        window = [from, to];
        return builder;
      },
      then<T>(
        resolve: (value: {
          data: Row[] | null;
          error: { message: string } | null;
        }) => T,
      ): T {
        calls.push({ table, from: window ? window[0] : null });
        if (options.failOn === table) {
          return resolve({ data: null, error: { message: `${table} failed` } });
        }
        const [from, to] = window ?? [0, maxRows - 1];
        const end = Math.min(to + 1, from + maxRows);
        return resolve({ data: rows.slice(from, end), error: null });
      },
    };
    return builder;
  }

  return { client: { from: query }, calls };
}
