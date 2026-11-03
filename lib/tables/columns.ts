// Reading a spreadsheet someone else exported: headers matched by alias and
// dates written in any of the usual ways. Shared by the fuel statement import
// and the importer (features/imports).

/** A header as compared: lowercase, no accents, only letters and digits. */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Column index per field; a field left out is not in the file. */
export type ColumnMapping<F extends string> = Partial<Record<F, number>>;

/** The mapping the header row suggests: an exact alias first, then a header
 *  that starts with one ("litros despachados (lts)"). Aliases are written
 *  normalized. Each column is used once, by the first field that claims it. */
export function suggestColumnMapping<F extends string>(
  header: readonly string[],
  fields: readonly F[],
  aliases: Readonly<Record<F, readonly string[]>>,
): ColumnMapping<F> {
  const normalized = header.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping<F> = {};
  for (const pass of ["exact", "prefix"] as const) {
    for (const field of fields) {
      if (mapping[field] !== undefined) continue;
      const index = normalized.findIndex(
        (h, i) =>
          !used.has(i) &&
          h !== "" &&
          aliases[field].some((a) =>
            pass === "exact" ? h === a : h.startsWith(`${a} `),
          ),
      );
      if (index >= 0) {
        mapping[field] = index;
        used.add(index);
      }
    }
  }
  return mapping;
}

/** The header row: among the first 15, the one that maps the most fields
 *  (at least 2). -1 when none does. */
export function findHeaderRowIndex<F extends string>(
  rows: readonly (readonly string[])[],
  fields: readonly F[],
  aliases: Readonly<Record<F, readonly string[]>>,
): number {
  let best = -1;
  let bestCount = 1;
  rows.slice(0, 15).forEach((row, i) => {
    const count = Object.keys(
      suggestColumnMapping(row, fields, aliases),
    ).length;
    if (count > bestCount) {
      best = i;
      bestCount = count;
    }
  });
  return best;
}

function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** "31/10/2026", "31-10-26 14:05", "2026-10-31T14:05" → "2026-10-31". */
export function parseSheetDate(raw: string): string | null {
  const value = raw.trim();
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(value);
  const ar = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:$|\s)/.exec(value);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (ar) {
    const year = Number(ar[3]);
    [y, m, d] = [year < 100 ? 2000 + year : year, Number(ar[2]), Number(ar[1])];
  } else {
    return null;
  }
  if (!isRealDate(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
