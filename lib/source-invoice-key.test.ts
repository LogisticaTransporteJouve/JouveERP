import { describe, expect, it } from "vitest";
import { z } from "zod";

import { recordingSupabase } from "@/tests/helpers/recording-supabase";

import {
  findSourceInvoiceSlot,
  MAX_INVOICE_ATTEMPTS,
  sourceInvoiceKey,
} from "./source-invoice-key";

const ID = "00000000-0000-4000-8000-000000000001";
const key = (attempt: number) =>
  sourceInvoiceKey("freight_settlement", ID, attempt);

function slotFor(
  rows: { id: string; status: string; idempotency_key: string }[] | null,
  // What billing_invoice_is_void answers per invoice id ("error" fails).
  voidRead: Record<string, boolean | "error"> = {},
  // Item count per draft id ("error" fails); a draft not listed has items.
  draftItems: Record<string, number | "error"> = {},
) {
  const fake = recordingSupabase((call) => {
    if (call.table === "invoice_items") {
      const id = String(call.filters.find(([, c]) => c === "invoice_id")?.[2]);
      const n = draftItems[id] ?? 1;
      return n === "error"
        ? { data: null, error: { message: "boom" } }
        : {
            data: Array.from({ length: n }, () => ({ invoice_id: id })),
            error: null,
          };
    }
    if (call.table === "billing_invoice_is_void") {
      const id = (call.payload as { p_invoice_id: string }).p_invoice_id;
      const answer = voidRead[id] ?? false;
      return answer === "error"
        ? { data: null, error: { message: "boom" } }
        : { data: answer, error: null };
    }
    return rows === null
      ? { data: null, error: { message: "boom" } }
      : { data: rows, error: null };
  });
  // The fake answers the builder chain; its type is not the client's.
  return {
    fake,
    run: () =>
      findSourceInvoiceSlot(
        fake.client as unknown as Parameters<typeof findSourceInvoiceSlot>[0],
        "freight_settlement",
        ID,
      ),
  };
}

describe("sourceInvoiceKey", () => {
  it("is a stable UUIDv5 the invoice schema accepts, distinct per source and attempt", () => {
    expect(key(0)).toBe(key(0));
    expect(z.string().uuid().safeParse(key(0)).success).toBe(true);
    expect(key(0)[14]).toBe("5");
    expect(
      new Set([key(0), key(1), sourceInvoiceKey("shipment_freight", ID, 0)])
        .size,
    ).toBe(3);
  });
});

describe("findSourceInvoiceSlot", () => {
  it("issues under attempt 0 when there is no invoice yet", async () => {
    const { fake, run } = slotFor([]);
    expect(await run()).toEqual({ kind: "free", key: key(0) });
    const probe = fake.calls[0];
    expect(probe?.table).toBe("invoices");
    expect(probe?.filters[0]?.[0]).toBe("in");
    expect(probe?.filters[0]?.[2]).toHaveLength(MAX_INVOICE_ATTEMPTS);
  });

  it("returns the live invoice instead of a new key, whoever issued it", async () => {
    const { run } = slotFor([
      { id: "inv0", status: "failed", idempotency_key: key(0) },
      { id: "inv1", status: "emitted", idempotency_key: key(1) },
    ]);
    expect(await run()).toEqual({ kind: "live", invoiceId: "inv1" });
  });

  it("treats a draft or emitting invoice as live", async () => {
    const { run } = slotFor([
      { id: "inv0", status: "draft", idempotency_key: key(0) },
    ]);
    expect(await run()).toEqual({ kind: "live", invoiceId: "inv0" });
  });

  it("moves past a draft with no items, which no run ever sends", async () => {
    const { fake, run } = slotFor(
      [
        { id: "inv0", status: "draft", idempotency_key: key(0) },
        { id: "inv1", status: "emitting", idempotency_key: key(1) },
      ],
      {},
      { inv0: 0 },
    );
    expect(await run()).toEqual({ kind: "live", invoiceId: "inv1" });
    // Only the draft is asked about.
    expect(
      fake.calls
        .filter((c) => c.table === "invoice_items")
        .map((c) => c.filters),
    ).toEqual([[["eq", "invoice_id", "inv0"]]]);
  });

  it("issues under the next key after a draft with no items", async () => {
    const { run } = slotFor(
      [{ id: "inv0", status: "draft", idempotency_key: key(0) }],
      {},
      { inv0: 0 },
    );
    expect(await run()).toEqual({ kind: "free", key: key(1) });
  });

  it("answers error, never a free key, when the items read fails", async () => {
    const { run } = slotFor(
      [{ id: "inv0", status: "draft", idempotency_key: key(0) }],
      {},
      { inv0: "error" },
    );
    expect(await run()).toEqual({ kind: "error" });
  });

  it("moves past void attempts", async () => {
    const { run } = slotFor([
      { id: "inv0", status: "failed", idempotency_key: key(0) },
      { id: "inv1", status: "cancelled", idempotency_key: key(1) },
    ]);
    expect(await run()).toEqual({ kind: "free", key: key(2) });
  });

  it("moves past a fiscal factura its NCs credit in full", async () => {
    const { fake, run } = slotFor(
      [
        { id: "inv0", status: "emitted", idempotency_key: key(0) },
        { id: "inv1", status: "draft", idempotency_key: key(1) },
      ],
      { inv0: true },
    );
    expect(await run()).toEqual({ kind: "live", invoiceId: "inv1" });
    // Only the emitted one is asked about.
    expect(
      fake.calls
        .filter((c) => c.table === "billing_invoice_is_void")
        .map((c) => c.payload),
    ).toEqual([{ p_invoice_id: "inv0" }]);
  });

  it("answers error, never a free key, when the credit read fails", async () => {
    const { run } = slotFor(
      [{ id: "inv0", status: "emitted", idempotency_key: key(0) }],
      { inv0: "error" },
    );
    expect(await run()).toEqual({ kind: "error" });
  });

  it("refuses past the last attempt", async () => {
    const { run } = slotFor(
      Array.from({ length: MAX_INVOICE_ATTEMPTS }, (_, i) => ({
        id: `inv${i}`,
        status: "failed",
        idempotency_key: key(i),
      })),
    );
    expect(await run()).toEqual({ kind: "exhausted" });
  });

  it("answers error on a failed read, never a free key", async () => {
    const { run } = slotFor(null);
    expect(await run()).toEqual({ kind: "error" });
  });
});
