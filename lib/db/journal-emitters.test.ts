import { describe, expect, it } from "vitest";

import { ALL_SQL, latestDefinition } from "./testing/migration-sql";

// Static check over supabase/migrations: plpgsql resolves calls only when it
// runs, so a function still calling a dropped emitter (or an old arity of a
// builder) would only fail when a document posts. 20261031180534 dropped the
// per-origin emitters and the p_reverse arity of the builders.

const DROPPED = [
  "emit_journal_for_invoice",
  "emit_journal_for_purchase_invoice",
  "emit_journal_for_receipt",
  "emit_journal_for_payment_order",
];

const BUILDERS = [
  "build_invoice_journal_lines",
  "build_purchase_invoice_journal_lines",
  "build_receipt_journal_lines",
  "build_payment_order_journal_lines",
  "build_transaction_journal_lines",
];

function lastIndex(pattern: RegExp): number {
  let last = -1;
  for (const match of ALL_SQL.matchAll(pattern)) last = match.index ?? -1;
  return last;
}

function createdFunctions(): string[] {
  const names = new Set(
    [
      ...ALL_SQL.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi,
      ),
    ].map((m) => (m[1] ?? "").toLowerCase()),
  );
  return [...names];
}

/** Whether the last `drop function public.<fn>(` comes after its last create. */
function isDropped(fn: string): boolean {
  const created = lastIndex(
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${fn}\\s*\\(`,
      "gi",
    ),
  );
  const dropped = lastIndex(
    new RegExp(
      `drop\\s+function\\s+(?:if\\s+exists\\s+)?public\\.${fn}\\s*\\(`,
      "gi",
    ),
  );
  return dropped > created;
}

/** Top-level argument count of every `public.<fn>(…)` call in `sql`. */
function callArities(sql: string, fn: string): number[] {
  const arities: number[] = [];
  const call = new RegExp(`public\\.${fn}\\s*\\(`, "gi");
  for (const match of sql.matchAll(call)) {
    let depth = 1;
    let commas = 0;
    let i = (match.index ?? 0) + match[0].length;
    for (; i < sql.length && depth > 0; i++) {
      const ch = sql[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 1) commas++;
    }
    arities.push(commas + 1);
  }
  return arities;
}

describe("journal emitters after 20261031180534", () => {
  // The builders' old arity is dropped after their new one is created.
  const bodies = createdFunctions()
    .filter((fn) => BUILDERS.includes(fn) || !isDropped(fn))
    .map((fn) => [fn, latestDefinition(fn)] as const);

  it.each(DROPPED)("%s is dropped and called by no live function", (fn) => {
    expect(isDropped(fn)).toBe(true);
    for (const [name, body] of bodies) {
      expect(body, name).not.toMatch(new RegExp(`public\\.${fn}\\s*\\(`, "i"));
    }
  });

  it.each(BUILDERS)("every call to %s passes (row, description)", (fn) => {
    expect(latestDefinition(fn)).toMatch(/p_description\s+text/);
    for (const [name, body] of bodies) {
      if (name === fn) continue;
      for (const arity of callArities(body, fn)) expect(arity, name).toBe(2);
    }
  });

  it("drops the p_reverse arity of the invoice and purchase builders", () => {
    expect(ALL_SQL).toMatch(
      /drop function public\.build_invoice_journal_lines\(public\.invoices, boolean, boolean\);/,
    );
    expect(ALL_SQL).toMatch(
      /drop function public\.build_purchase_invoice_journal_lines\(public\.purchase_invoices, boolean\);/,
    );
  });
});
