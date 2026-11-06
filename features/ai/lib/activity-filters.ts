// The arguments a tool call ran with, as short Spanish labels for the
// activity block: "AB123CD · 01/10/2026 – 31/10/2026". Lets the user check the
// assistant read the question right (the truck, the client, the period)
// before trusting the answer. Generic over every tool's input: dates and
// months are formatted, paging and ids are left out, nested values skipped.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paging and display knobs: not what the user asked about. */
const SKIP = new Set(["limit", "offset", "cursor", "page", "pageSize"]);

const FROM_KEYS = ["from", "desde", "date_from", "fromDate", "start_date"];
const TO_KEYS = ["to", "hasta", "date_to", "toDate", "end_date"];

const MAX_FILTERS = 4;
const MAX_TEXT = 40;

function formatValue(value: unknown): string | null {
  if (typeof value === "string") {
    const v = value.trim();
    if (v === "" || UUID.test(v)) return null;
    const d = ISO_DATE.exec(v);
    if (d) return `${d[3]}/${d[2]}/${d[1]}`;
    const m = ISO_MONTH.exec(v);
    if (m) return `${m[2]}/${m[1]}`;
    return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT - 1)}…` : v;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("es-AR");
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function activityFilters(input: unknown): string[] {
  if (!isRecord(input)) return [];
  const out: string[] = [];
  const used = new Set<string>();

  const fromKey = FROM_KEYS.find((k) => k in input);
  const toKey = TO_KEYS.find((k) => k in input);
  const from = fromKey ? formatValue(input[fromKey]) : null;
  const to = toKey ? formatValue(input[toKey]) : null;
  let range: string | null = null;
  if (from && to) range = from === to ? from : `${from} – ${to}`;
  else if (from) range = `desde ${from}`;
  else if (to) range = `hasta ${to}`;
  if (fromKey) used.add(fromKey);
  if (toKey) used.add(toKey);

  for (const [key, value] of Object.entries(input)) {
    if (used.has(key) || SKIP.has(key)) continue;
    const text = formatValue(value);
    if (text) out.push(text);
  }
  // The period reads best last: "AB123CD · 01/10/2026 – 31/10/2026".
  if (range) out.push(range);
  return out.slice(-MAX_FILTERS);
}
