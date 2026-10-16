import {
  ARTIFACT_LIMITS,
  type ChartConfig,
  type PinRequest,
  type TableConfig,
} from "./spec";

// Pins store field names. When a read action renames its row fields, a pin
// saved before the rename would fail with "Field is not in the result"; these
// maps carry the old names to the new ones. The aging tools split every amount
// by currency, so an old mixed amount becomes its pesos and dollars fields.

type Target = { field: string; suffix: string };

const AGING_BUCKETS = ["0_30", "30_60", "60_90", "90_plus"];

function byCurrency(field: string): Target[] {
  return [
    { field: `${field}_ars`, suffix: " $" },
    { field: `${field}_usd`, suffix: " US$" },
  ];
}

const AGING_LEGACY: Record<string, Target[]> = {
  client_legal_name: [{ field: "legal_name", suffix: "" }],
  supplier_legal_name: [{ field: "legal_name", suffix: "" }],
  supplier_cuit: [{ field: "cuit", suffix: "" }],
  total_open: byCurrency("total"),
  ...Object.fromEntries(
    AGING_BUCKETS.map((b) => [`bucket_${b}`, byCurrency(`bucket_${b}`)]),
  ),
};

export const LEGACY_FIELDS: Record<string, Record<string, Target[]>> = {
  getClientAging: AGING_LEGACY,
  getSupplierAging: AGING_LEGACY,
};

export const LEGACY_FIELDS_NOTE =
  "Vista guardada actualizada: los importes ahora se muestran por moneda.";

type Field = { field: string; label?: string };

function expand(
  fields: readonly Field[],
  map: Record<string, Target[]>,
  present: ReadonlySet<string>,
  max: number,
): Field[] {
  const out: Field[] = [];
  for (const f of fields) {
    const targets = present.has(f.field) ? undefined : map[f.field];
    const next: Field[] = targets
      ? targets.map((t) => ({
          field: t.field,
          ...(f.label ? { label: `${f.label}${t.suffix}` } : {}),
        }))
      : [f];
    for (const n of next) {
      if (!out.some((o) => o.field === n.field)) out.push(n);
    }
  }
  return out.slice(0, max);
}

/**
 * The pin's config with legacy field names replaced by the current ones.
 * `present` is the set of fields the action returns today; a name it still
 * returns is never rewritten. `upgraded` tells whether anything changed.
 */
export function upgradeLegacyFields(
  request: PinRequest,
  present: ReadonlySet<string>,
): { request: PinRequest; upgraded: boolean } {
  const map = LEGACY_FIELDS[request.source.action];
  if (!map) return { request, upgraded: false };

  if (request.kind === "table") {
    const columns = request.config.columns;
    if (!columns) return { request, upgraded: false };
    const next = expand(columns, map, present, ARTIFACT_LIMITS.tableColumns);
    const upgraded = JSON.stringify(next) !== JSON.stringify(columns);
    const config: TableConfig = { ...request.config, columns: next };
    return { request: { ...request, config }, upgraded };
  }

  const config: ChartConfig = { ...request.config };
  let upgraded = false;
  const x = config.x;
  if (x && !present.has(x) && map[x]) {
    config.x = map[x][0]?.field;
    upgraded = true;
  }
  if (config.series) {
    const series = expand(config.series, map, present, ARTIFACT_LIMITS.series);
    if (JSON.stringify(series) !== JSON.stringify(config.series)) {
      config.series = series;
      upgraded = true;
    }
  }
  return { request: { ...request, config }, upgraded };
}
