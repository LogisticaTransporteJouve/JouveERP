// Integration coverage for the audit-remediation money guards, exercised against
// a local Supabase instance. Gated by RUN_INTEGRATION=1.
//
// Covers: allocation over-application + cross-counterparty guards, and the
// accounting period-close guard. Uses the service client (guards are triggers,
// so they fire regardless of RLS).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RUN_INTEGRATION, makeServiceClient } from "./_setup";

const d = RUN_INTEGRATION ? describe : describe.skip;

d("money guards (integration)", () => {
  // Built lazily: the describe body runs at collection time even when skipped,
  // and the client throws without SUPABASE env vars.
  let service: SupabaseClient;
  const created: { table: string; id: string }[] = [];
  let channelId: string;
  let clientA: string;
  let clientB: string;
  let invoiceA: string;
  let receiptA: string;

  beforeAll(async () => {
    service = makeServiceClient();
    const { data: ch } = await service
      .from("invoicing_channels")
      .select("id")
      .eq("is_fiscal", false)
      .limit(1)
      .single();
    channelId = ch!.id;
    const { data: clients } = await service
      .from("clients")
      .select("id")
      .limit(2);
    clientA = clients![0]!.id;
    clientB = clients![1]!.id;

    const stamp = Date.now();
    const { data: inv, error: invErr } = await service
      .from("invoices")
      .insert({
        channel_id: channelId,
        client_id: clientA,
        kind: "factura",
        punto_venta: 3,
        numero: 800000 + (stamp % 90000),
        fecha: "2026-07-04",
        concepto: 1,
        doc_tipo: 80,
        doc_nro: "0",
        imp_neto: 100,
        imp_iva: 0,
        imp_total: 100,
        moneda: "PES",
        cotizacion: 1,
        status: "emitted",
        idempotency_key: crypto.randomUUID(),
      })
      .select("id")
      .single();
    if (invErr) throw new Error(`invoice insert: ${invErr.message}`);
    invoiceA = inv!.id;
    created.push({ table: "invoices", id: invoiceA });

    const { data: rc } = await service
      .from("receipts")
      .insert({
        channel_id: channelId,
        punto_venta: 3,
        numero: 800000 + (stamp % 90000),
        client_id: clientA,
        receipt_date: "2026-07-04",
        total_amount: 100,
        currency: "ARS",
        status: "issued",
      })
      .select("id")
      .single();
    receiptA = rc!.id;
    created.push({ table: "receipts", id: receiptA });
  });

  afterAll(async () => {
    for (const { table, id } of created.reverse()) {
      await service.from(table).delete().eq("id", id);
    }
  });

  it("accepts a valid allocation within the invoice total", async () => {
    const { error } = await service.from("receipt_allocations").insert({
      receipt_id: receiptA,
      invoice_id: invoiceA,
      amount_applied: 60,
    });
    expect(error).toBeNull();
  });

  it("rejects over-application beyond the invoice total", async () => {
    const { error } = await service.from("receipt_allocations").insert({
      receipt_id: receiptA,
      invoice_id: invoiceA,
      amount_applied: 60,
    });
    expect(error).not.toBeNull();
  });

  it("rejects allocating an invoice of another client", async () => {
    const stamp = Date.now();
    const { data: inv2 } = await service
      .from("invoices")
      .insert({
        channel_id: channelId,
        client_id: clientB,
        kind: "factura",
        punto_venta: 3,
        numero: 700000 + (stamp % 90000),
        fecha: "2026-07-04",
        concepto: 1,
        doc_tipo: 80,
        doc_nro: "0",
        imp_neto: 100,
        imp_iva: 0,
        imp_total: 100,
        moneda: "PES",
        cotizacion: 1,
        status: "emitted",
        idempotency_key: crypto.randomUUID(),
      })
      .select("id")
      .single();
    created.push({ table: "invoices", id: inv2!.id });
    const { error } = await service.from("receipt_allocations").insert({
      receipt_id: receiptA,
      invoice_id: inv2!.id,
      amount_applied: 10,
    });
    expect(error).not.toBeNull();
  });

  it("blocks journal writes in a closed accounting period", async () => {
    await service
      .from("accounting_closed_periods")
      .insert({ period: "2020-01" });
    try {
      const { data: accs } = await service
        .from("chart_of_accounts")
        .select("id")
        .eq("is_active", true)
        .limit(2);
      const { error } = await service.rpc("create_journal_entry", {
        p_entry_date: "2020-01-15",
        p_accrual_period: "2020-01",
        p_description: "int test closed",
        p_lines: [
          { account_id: accs![0]!.id, debit: 10 },
          { account_id: accs![1]!.id, credit: 10 },
        ],
      });
      expect(error).not.toBeNull();
    } finally {
      await service
        .from("accounting_closed_periods")
        .delete()
        .eq("period", "2020-01");
    }
  });
});
