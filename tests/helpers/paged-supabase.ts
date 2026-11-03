// A fake RLS client for unit tests of reads that drain past PostgREST's
// max_rows: every query on a table resolves to that table's rows, and
// `.range(from, to)` serves at most `maxRows` of them, the way PostgREST
// silently caps a response. Filters are accepted and ignored, unless
// `applyFilters` is set: then `eq`, `gte` and `lte` filter the rows, on a
// column or on an embedded path ("receipt.status"), the way an `!inner`
// embed drops the parent row whose child does not match.

type Row = Record<string, unknown>;

export const FAKE_MAX_ROWS = 1000;

export function pagedSupabase(
  tables: Record<string, Row[]>,
  options: { maxRows?: number; failOn?: string; applyFilters?: boolean } = {},
) {
  const maxRows = options.maxRows ?? FAKE_MAX_ROWS;
  const calls: { table: string; from: number | null }[] = [];

  function query(table: string) {
    let rows = tables[table] ?? [];
    let window: [number, number] | null = null;
    const filter =
      (keep: (cell: unknown, value: unknown) => boolean) =>
      (path: string, value: unknown) => {
        if (options.applyFilters) {
          rows = rows.filter((row) => keep(cellAt(row, path), value));
        }
        return builder;
      };
    const builder = {
      select: () => builder,
      eq: filter((cell, value) => cell === value),
      gte: filter((cell, value) => compare(cell, value) >= 0),
      lte: filter((cell, value) => compare(cell, value) <= 0),
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

function cellAt(row: Row, path: string): unknown {
  let cell: unknown = row;
  for (const key of path.split(".")) {
    if (!isRow(cell)) return undefined;
    cell = cell[key];
  }
  return cell;
}

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object";
}

function compare(cell: unknown, value: unknown): number {
  if (cell === undefined || cell === null) return Number.NaN;
  return String(cell) < String(value)
    ? -1
    : String(cell) > String(value)
      ? 1
      : 0;
}
