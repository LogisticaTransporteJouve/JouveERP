// Natural keys of imported rows. commit_import_run compares the same way
// (supabase/migrations/20261103110000_import_runs.sql): names trimmed, runs of
// whitespace collapsed and lowercased; patentes as their letters and digits.

export function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function plateKey(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** A client or supplier: by CUIT when it has one (Ventas/Compras), else by
 *  name among the internal ones (Otras ventas/compras). */
export function counterpartyKey(row: {
  cuit: string | null;
  legal_name: string;
}): string {
  return row.cuit ? `cuit:${row.cuit}` : `name:${nameKey(row.legal_name)}`;
}

/** The keys already taken by existing clients or suppliers. */
export function existingCounterpartyKeys(
  rows: readonly {
    cuit: string | null;
    legal_name: string;
    is_fiscal: boolean;
  }[],
): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.is_fiscal && r.cuit) out.add(`cuit:${r.cuit}`);
    if (!r.is_fiscal) out.add(`name:${nameKey(r.legal_name)}`);
  }
  return out;
}

/** An employee: by CUIL when the row has one, else by name. */
export function employeeKey(row: {
  cuil: string | null;
  legal_name: string;
}): string {
  return row.cuil ? `cuil:${row.cuil}` : `name:${nameKey(row.legal_name)}`;
}

/** Every existing employee's CUIL and name: a row without CUIL is a
 *  duplicate of anyone with its name. */
export function existingEmployeeKeys(
  rows: readonly { cuil: string | null; legal_name: string }[],
): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.cuil) out.add(`cuil:${r.cuil}`);
    out.add(`name:${nameKey(r.legal_name)}`);
  }
  return out;
}

export function vehicleKey(patente: string): string {
  return `plate:${plateKey(patente)}`;
}

export function historicPayrollKey(row: {
  employee_id: string;
  period: string;
  kind: string;
}): string {
  return `${row.employee_id}|${row.period}|${row.kind}`;
}
