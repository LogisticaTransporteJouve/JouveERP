/** "Origen → Destino", with a dash for the missing end. */
export function formatRoute(
  origin: string | null,
  destination: string | null,
): string {
  if (!origin && !destination) return "—";
  return `${origin ?? "—"} → ${destination ?? "—"}`;
}

/** Lowercase, no accents, spaces collapsed: how the list search compares. */
function fold(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The carga list search: its client's remito (ignoring spaces, as the
 *  unique index does), client, origin, destination or description. Blank
 *  matches everything. */
export function matchesShipmentSearch(
  s: {
    remito_number: string | null;
    origin: string | null;
    destination: string | null;
    description: string | null;
    client: { legal_name: string; display_name: string | null } | null;
  },
  term: string,
): boolean {
  const q = fold(term);
  if (q === "") return true;
  const compact = q.replace(/ /g, "");
  if (
    s.remito_number &&
    fold(s.remito_number).replace(/ /g, "").includes(compact)
  ) {
    return true;
  }
  return [
    s.client?.legal_name,
    s.client?.display_name,
    s.origin,
    s.destination,
    s.description,
  ].some((v) => v !== null && v !== undefined && fold(v).includes(q));
}

/** "0001-00001234" → [1, 1234]: the number groups of a remito, without
 *  leading zeros, so "1-1234", "0001-00001234" and "R 0001 1234" compare
 *  equal. */
export function remitoNumberGroups(remito: string): number[] {
  return (remito.match(/\d+/g) ?? []).map((g) => Number(g));
}

/** Whether a carga's remito is the scanned one (punto de venta and number,
 *  or just the number when either side carries no punto de venta). */
export function remitoMatches(
  remito: string,
  scanned: { sales_point: number | null; number: number },
): boolean {
  const groups = remitoNumberGroups(remito);
  if (groups.length === 0) return false;
  const last = groups[groups.length - 1];
  if (last !== scanned.number) return false;
  if (groups.length === 1 || scanned.sales_point === null) return true;
  return groups[groups.length - 2] === scanned.sales_point;
}

/** POSIX regex (Postgres `~`) for a remito whose last digit group is
 *  `number`, leading zeros aside: the SQL side of `remitoMatches`. */
export function remitoNumberPattern(number: number): string {
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`remitoNumberPattern: invalid number ${number}`);
  }
  return `(^|[^0-9])0*${number}[^0-9]*$`;
}

/** "0001-00001234", or the bare number without a punto de venta. */
export function scannedRemitoLabel(scanned: {
  sales_point: number | null;
  number: number;
}): string {
  const n = String(scanned.number).padStart(8, "0");
  return scanned.sales_point === null
    ? n
    : `${String(scanned.sales_point).padStart(4, "0")}-${n}`;
}
