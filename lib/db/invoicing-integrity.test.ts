import { describe, expect, it } from "vitest";

import {
  ALL_SQL,
  lastStatement,
  latestDefinition,
} from "./testing/migration-sql";

// Static checks over supabase/migrations for the invoicing invariants the
// app relies on but cannot enforce itself.

function lastPolicyStatement(name: string, table: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return lastStatement(
    new RegExp(
      `(?:create|drop) policy (?:if exists )?"${escaped}"\\s+on public\\.${table}\\b`,
      "gi",
    ),
  );
}

describe("invoices are written only by the service role", () => {
  it.each([
    ["Authenticated finance can insert invoices", "invoices"],
    ["Authenticated finance can update invoices", "invoices"],
    ["Authenticated finance can insert invoice items", "invoice_items"],
    ["Authenticated finance can update invoice items", "invoice_items"],
    ["Authenticated finance can delete invoice items", "invoice_items"],
  ])("%s is dropped", (name, table) => {
    expect(lastPolicyStatement(name, table)).toMatch(/^drop policy/i);
  });

  it.each(["invoices", "invoice_items"])(
    "%s write privileges are revoked from anon and authenticated",
    (table) => {
      expect(ALL_SQL).toMatch(
        new RegExp(
          `revoke insert, update, delete on public\\.${table} from anon, authenticated;`,
        ),
      );
    },
  );
});

describe("internal and CAEA numbering", () => {
  it("returns the number an internal invoice already holds", () => {
    const definition = latestDefinition("next_internal_invoice_numero_atomic");
    const reuse = definition.search(
      /if v_existing is not null then\s+return v_existing;/,
    );
    const nextMax = definition.indexOf("max(numero)");
    expect(reuse).toBeGreaterThan(0);
    expect(nextMax).toBeGreaterThan(reuse);
  });

  it("numbers and emits CAEA vouchers in one locked, idempotent, service-role-only call", () => {
    const definition = latestDefinition("emit_caea_invoice");
    const lock = definition.indexOf("pg_advisory_xact_lock");
    const reuse = definition.search(
      /if v_existing is not null then\s+return v_existing;/,
    );
    const nextMax = definition.indexOf("max(numero)");
    expect(lock).toBeGreaterThan(0);
    expect(reuse).toBeGreaterThan(lock);
    expect(nextMax).toBeGreaterThan(reuse);
    expect(definition).toMatch(
      /set numero\s+= v_next,[\s\S]*status\s+= 'emitted'/,
    );
    expect(definition).toMatch(/set search_path = public/);
    expect(
      lastStatement(
        /revoke all on function public\.emit_caea_invoice\([^;]*;/gi,
      ),
    ).toMatch(/from public, anon, authenticated;$/);
  });
});

describe("failed and cancelled invoices release what they billed", () => {
  it("clears the shipment link and the storage period", () => {
    const definition = latestDefinition("release_invoice_billing_links");
    expect(definition).toMatch(
      /update public\.shipments\s+set invoice_id = null/,
    );
    expect(definition).toMatch(/delete from public\.storage_billing_runs/);
    const trigger = lastStatement(
      /create trigger invoices_release_billing_links[\s\S]*?;/gi,
    );
    expect(trigger).toMatch(/after update of status on public\.invoices/);
    // Only a pending emission releases by failing; an emitted one never does.
    expect(trigger).toMatch(
      /new\.status = 'failed' and old\.status in \('draft', 'emitting'\)/,
    );
    expect(trigger).not.toMatch(/new\.status in \('failed', 'cancelled'\)/);
  });
});

describe("NCs count against their origin", () => {
  it("aging subtracts emitted NCs from the open amount", () => {
    const view = lastStatement(
      /create or replace view public\.v_aging_documents[\s\S]*?;\n/gi,
    );
    expect(view).toMatch(
      /- COALESCE\(nc\.credited, 0::numeric\) AS open_amount/,
    );
    expect(view).toMatch(
      /n\.kind = 'nc'::text AND n\.status = 'emitted'::text/,
    );
  });

  it("receipt allocations reject NCs and non-emitted invoices and include NC credits", () => {
    const definition = latestDefinition("guard_receipt_allocation");
    expect(definition).toMatch(
      /v_status <> 'emitted' or v_kind not in \('factura', 'nd'\)/,
    );
    expect(definition).toMatch(
      /v_sum \+ v_credited \+ new\.amount_applied > v_total \+ 0\.01/,
    );
  });
});

describe("cancelling an invoice with money applied", () => {
  it("is refused for receipts (22023) and for the opening balance (23514)", () => {
    const definition = latestDefinition(
      "guard_cancel_invoice_with_allocations",
    );
    expect(definition).toMatch(/r\.status = 'issued'[\s\S]*?errcode = '22023'/);
    expect(definition).toMatch(
      /client_opening_balance_allocations[\s\S]*?errcode = '23514'/,
    );
  });
});
