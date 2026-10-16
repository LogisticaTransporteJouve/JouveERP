import { describe, expect, it } from "vitest";

import { lastStatement, latestDefinition } from "./testing/migration-sql";

// Static checks over supabase/migrations: the libro IVA is in pesos with the
// same rate and rounding as each document's journal entry, and aging never
// sums pesos and dollars.

describe.each([
  {
    fn: "libro_iva_ventas",
    alias: "i",
    journal: "build_invoice_journal_lines",
    amounts: [
      "neto",
      "iva",
      "imp_trib",
      "imp_op_ex",
      "imp_tot_conc",
      "imp_total",
    ],
    docRounding: [
      "round((f.imp_neto + f.imp_op_ex + f.imp_tot_conc) * f.fx, 2) as revenue",
      "round(f.imp_op_ex * f.fx, 2)    as op_ex",
      "round(f.imp_tot_conc * f.fx, 2) as tot_conc",
      "round(f.imp_iva * f.fx, 2)      as iva",
      "round(f.imp_trib * f.fx, 2)     as trib",
    ],
    totalExpr: "d.revenue + d.iva + d.trib,",
  },
  {
    fn: "libro_iva_compras",
    alias: "p",
    journal: "build_purchase_invoice_journal_lines",
    amounts: ["neto", "iva", "imp_trib", "imp_total"],
    docRounding: [
      "round(f.imp_neto * f.fx, 2) as neto",
      "round(f.imp_iva * f.fx, 2)  as iva",
      "round(f.imp_trib * f.fx, 2) as trib",
    ],
    totalExpr: "d.neto + d.iva + d.trib,",
  },
])("$fn", ({ fn, alias, journal, amounts, docRounding, totalExpr }) => {
  const definition = latestDefinition(fn);

  it("uses the journal's rate: PES at 1, else cotizacion, else the official rate", () => {
    expect(definition).toContain(
      `when ${alias}.moneda is null or ${alias}.moneda = 'PES' then 1::numeric`,
    );
    expect(definition).toMatch(
      new RegExp(
        `nullif\\(${alias}\\.cotizacion, 0\\),\\s+public\\.get_exchange_rate\\('USD', ${alias}\\.fecha\\),\\s+1`,
      ),
    );
    // Same fallback chain as the journal emitter.
    expect(latestDefinition(journal)).toMatch(
      /nullif\(p_invoice\.cotizacion, 0\),\s+public\.get_exchange_rate\('USD', p_invoice\.fecha\),\s+1/,
    );
  });

  it("rounds each header component once, like the journal entry", () => {
    for (const expr of docRounding) expect(definition).toContain(expr);
    expect(definition).toContain(totalExpr);
  });

  it("gives the alícuota rows' cent difference to the document's largest row", () => {
    expect(definition).toMatch(
      /row_number\(\) over \(w order by abs\(cb\.neto\) desc, cb\.iva_rate_id nulls last\) as neto_rank/,
    );
    expect(definition).toMatch(
      /row_number\(\) over \(w order by abs\(cb\.iva\) desc, cb\.iva_rate_id nulls last\)\s+as iva_rank/,
    );
    expect(definition).toContain(
      "cb.iva_r + case when cb.iva_rank = 1 then d.iva - cb.iva_r_sum else 0 end",
    );
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
