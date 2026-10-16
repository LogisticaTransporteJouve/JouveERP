import { describe, expect, it } from "vitest";

import { lastStatement, latestDefinition } from "./testing/migration-sql";

// Static checks over supabase/migrations: the libro IVA is in pesos at each
// document's cotizacion, and aging never sums pesos and dollars.

describe.each([
  [
    "libro_iva_ventas",
    "i",
    ["neto", "iva", "imp_trib", "imp_op_ex", "imp_tot_conc", "imp_total"],
  ],
  ["libro_iva_compras", "p", ["neto", "iva", "imp_trib", "imp_total"]],
])("%s", (fn, alias, amounts) => {
  const definition = latestDefinition(fn);

  it("converts every amount to pesos at the document's cotizacion, rounded to cents", () => {
    expect(definition).toMatch(
      new RegExp(`when ${alias}\\.moneda = 'PES' then 1::numeric`),
    );
    expect(definition).toContain(
      `else coalesce(nullif(${alias}.cotizacion, 0), 1)`,
    );
    for (const col of amounts) {
      const source =
        col === "neto" || col === "iva" ? `cb.${col}` : `${alias}.${col}`;
      expect(definition).toContain(`round(${source} * ${alias}.fx, 2)`);
    }
  });

  it("returns the original currency, cotizacion and *_orig amounts", () => {
    expect(definition).toMatch(/moneda\s+text,\s+cotizacion\s+numeric/);
    for (const col of amounts) {
      expect(definition).toMatch(new RegExp(`${col}_orig\\s+numeric`));
    }
  });

  it("stays security invoker with a pinned search_path", () => {
    expect(definition).toMatch(/security invoker\s+set search_path = public/);
  });

  it("is executable by authenticated only", () => {
    expect(
      lastStatement(
        new RegExp(`revoke all on function public\\.${fn}\\([^;]*;`, "gi"),
      ),
    ).toMatch(/from public, anon, authenticated;$/);
    expect(
      lastStatement(
        new RegExp(`grant execute on function public\\.${fn}\\([^;]*;`, "gi"),
      ),
    ).toMatch(/to authenticated;$/);
  });
});

describe.each([
  ["v_client_aging", "v_aging_documents"],
  ["v_supplier_aging", "v_supplier_aging_documents"],
])("%s", (view, source) => {
  const definition = lastStatement(
    new RegExp(
      `create (?:or replace )?view public\\.${view} [\\s\\S]*?;\\n`,
      "gi",
    ),
  );

  it("splits every bucket and the total by currency", () => {
    expect(definition).toContain(`from public.${source} d`);
    expect(definition).toMatch(/security_invoker = on/);
    for (const bucket of ["0_30", "30_60", "60_90", "90_plus"]) {
      expect(definition).toContain(
        `filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '${bucket}'), 0) as ars_bucket_${bucket}`,
      );
      expect(definition).toContain(
        `filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '${bucket}'), 0) as usd_bucket_${bucket}`,
      );
    }
    expect(definition).toMatch(/as ars_total_open/);
    expect(definition).toMatch(/as usd_total_open/);
  });

  it("has no sum across currencies", () => {
    expect(definition).not.toMatch(/sum\(d\.open_amount\)\s+as/);
    expect(definition).not.toMatch(/\btotal_open\b/);
  });
});
