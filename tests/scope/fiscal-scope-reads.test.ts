import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// Every list read takes the scope as `isFiscal` and narrows on the channel it
// embeds (or the view's channel_is_fiscal): a boolean filters and drops rows
// without a channel; null leaves the query untouched.

let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "exchange_rates") return { data: null, error: null };
  return { data: [], error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"], []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/channels", () => ({ getInvoicingChannels: async () => [] }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn() } }));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { listInvoicesAction } =
  await import("@/features/invoices/actions/invoices-actions");
const { listReceiptsAction } =
  await import("@/features/receipts/actions/receipts-actions");
const { listPaymentOrdersAction } =
  await import("@/features/payment-orders/actions/payment-orders-actions");
const { listChecksAction } =
  await import("@/features/checks/actions/checks-actions");
const { listIssuedChecksAction } =
  await import("@/features/issued-checks/actions/issued-checks-actions");
const { listLoansAction } =
  await import("@/features/loans/actions/loans-actions");
const { listRecurringPaymentsAction } =
  await import("@/features/recurring-payments/actions/recurring-payments-actions");
const { listTransactionsAction } =
  await import("@/features/transactions/actions/transactions-actions");
const { getAgingSummaryAction } =
  await import("@/features/aging/actions/aging-actions");
const { getSupplierAgingAction } =
  await import("@/features/suppliers/actions/account-actions");
const { searchPurchaseInvoicesAction } =
  await import("@/features/purchase-invoices/actions/purchase-invoices-actions");

beforeEach(() => {
  fake = recordingSupabase(respond);
});

type Read = (isFiscal: boolean | null) => Promise<unknown>;

const embedReads: [string, string, Read][] = [
  ["invoices", "invoices", (isFiscal) => listInvoicesAction({ isFiscal })],
  ["receipts", "receipts", (isFiscal) => listReceiptsAction({ isFiscal })],
  [
    "payment orders",
    "payment_orders",
    (isFiscal) => listPaymentOrdersAction({ isFiscal }),
  ],
  ["checks", "checks", (isFiscal) => listChecksAction({ isFiscal })],
  [
    "issued checks",
    "issued_checks",
    (isFiscal) => listIssuedChecksAction({ isFiscal }),
  ],
  ["loans", "loans", (isFiscal) => listLoansAction({ isFiscal })],
  [
    "recurring payments",
    "recurring_payments",
    (isFiscal) => listRecurringPaymentsAction({ isFiscal }),
  ],
];

const viewReads: [string, string, string, Read][] = [
  [
    "transactions",
    "v_transactions_tagged",
    "v_transactions_tagged",
    (isFiscal) => listTransactionsAction({ is_fiscal: isFiscal }),
  ],
  [
    "client aging",
    "v_client_aging",
    "v_client_aging_by_scope",
    (isFiscal) => getAgingSummaryAction({ isFiscal }),
  ],
  [
    "supplier aging",
    "v_supplier_aging",
    "v_supplier_aging_by_scope",
    (isFiscal) => getSupplierAgingAction({ isFiscal }),
  ],
];

function callOn(table: string): RecordedCall {
  const call = fake.calls.find((c) => c.table === table);
  if (!call) throw new Error(`no query on ${table}`);
  return call;
}

describe.each(embedReads)("%s", (_name, table, read) => {
  it.each([true, false])(
    "with %s filters the channel embed and drops rows without a channel",
    async (isFiscal) => {
      await read(isFiscal);
      expect(callOn(table).filters).toEqual(
        expect.arrayContaining([
          ["eq", "channel.is_fiscal", isFiscal],
          ["not", "channel", ["is", null]],
        ]),
      );
    },
  );

  it("with null (Todos) adds no scope filter", async () => {
    await read(null);
    const scoped = callOn(table).filters.filter(
      ([, column]) => column === "channel.is_fiscal" || column === "channel",
    );
    expect(scoped).toEqual([]);
  });
});

describe.each(viewReads)("%s", (_name, allView, scopedView, read) => {
  it.each([true, false])(
    "with %s reads channel_is_fiscal",
    async (isFiscal) => {
      await read(isFiscal);
      expect(callOn(scopedView).filters).toContainEqual([
        "eq",
        "channel_is_fiscal",
        isFiscal,
      ]);
    },
  );

  it("with null (Todos) reads every channel", async () => {
    await read(null);
    const call = callOn(allView);
    expect(
      call.filters.some(([, column]) => column === "channel_is_fiscal"),
    ).toBe(false);
  });
});

describe("purchase invoices", () => {
  it.each([true, false, null])("passes %s as p_is_fiscal", async (isFiscal) => {
    await searchPurchaseInvoicesAction({ isFiscal });
    const call = callOn("search_purchase_invoices");
    expect(call.payload).toMatchObject({
      p_is_fiscal: isFiscal ?? undefined,
    });
  });
});

describe("NC/ND origin search", () => {
  it("filters kind, fiscal scope and active channel on the server", async () => {
    await listInvoicesAction({
      status: "emitted",
      kind: "factura",
      isFiscal: true,
      activeChannelOnly: true,
      limit: 25,
    });
    expect(callOn("invoices").filters).toEqual(
      expect.arrayContaining([
        ["eq", "kind", "factura"],
        ["eq", "channel.is_fiscal", true],
        ["eq", "channel.is_active", true],
        ["eq", "status", "emitted"],
      ]),
    );
  });
});
