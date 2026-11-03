/** A retention as the receipt form sends it or as it is stored. */
type RetentionFields = {
  kind: string;
  tax_type: string;
  jurisdiction?: string | null;
  certificate_number: string;
  certificate_date: string;
  amount: number | string;
  notes?: string | null;
};

function retentionKey(r: RetentionFields): string {
  return JSON.stringify([
    r.kind,
    r.tax_type,
    r.jurisdiction ?? null,
    r.certificate_number.trim(),
    r.certificate_date,
    Math.round(Number(r.amount) * 100),
    r.notes ?? null,
  ]);
}

/** Whether two lists hold the same retentions, in any order: what an edit
 *  without retentions:write may send back unchanged. */
export function sameRetentions(
  a: readonly RetentionFields[],
  b: readonly RetentionFields[],
): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(retentionKey).sort();
  const right = b.map(retentionKey).sort();
  return left.every((key, i) => key === right[i]);
}
