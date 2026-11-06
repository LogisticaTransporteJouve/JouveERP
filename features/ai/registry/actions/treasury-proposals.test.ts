import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listAccountsAction = vi.fn();
const searchClientsAction = vi.fn();
const searchSuppliersAction = vi.fn();
const readInvoicingChannels = vi.fn();
const listPendingComprobantesForClientAction = vi.fn();
const getNextReceiptNumeroAction = vi.fn();
const getReceiptUsdRateAction = vi.fn();
const listPendingInvoicesForSupplierAction = vi.fn();
const getNextPaymentOrderNumeroAction = vi.fn();
const getPaymentOrderUsdRateAction = vi.fn();
const createReceipt = vi.fn();
const createPaymentOrder = vi.fn();
const createTransaction = vi.fn();
const createTransfer = vi.fn();

vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction,
}));
vi.mock("@/features/clients/actions/clients-actions", () => ({
  searchClientsAction,
}));
vi.mock("@/features/suppliers/actions/suppliers-actions", () => ({
  searchSuppliersAction,
}));
vi.mock("@/lib/channels", () => ({ readInvoicingChannels }));
vi.mock("@/features/receipts/actions/receipts-actions", () => ({
  listPendingComprobantesForClientAction,
  getNextReceiptNumeroAction,
  getReceiptUsdRateAction,
}));
vi.mock("@/features/payment-orders/actions/payment-orders-actions", () => ({
  listPendingInvoicesForSupplierAction,
  getNextPaymentOrderNumeroAction,
  getPaymentOrderUsdRateAction,
}));
vi.mock("@/lib/commands/create-receipt", () => ({ createReceipt }));
vi.mock("@/lib/commands/create-payment-order", () => ({ createPaymentOrder }));
vi.mock("@/lib/commands/create-transaction", () => ({ createTransaction }));
vi.mock("@/lib/commands/create-transfer", () => ({ createTransfer }));

const {
  proposeCashMovement,
  proposePaymentOrder,
  proposeReceipt,
  proposeTransfer,
} = await import("./treasury-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENT = id(1);
const SUPPLIER = id(2);
const GALICIA = id(3);
const CAJA = id(4);
const CARTERA = id(5);
const DOLARES = id(6);
const FC1 = id(10);
const FC2 = id(11);

const account = (
  accountId: string,
  name: string,
  type: string,
  currency = "ARS",
) => ({ id: accountId, name, type, currency, is_active: true });

const FISCAL = {
  id: "jouve_fiscal",
  name: "Jouve fiscal",
  is_fiscal: true,
  is_active: true,
};
const INTERNAL = {
  id: "jouve_internal",
  name: "Jouve interno",
  is_fiscal: false,
  is_active: true,
};

const pendingInvoice = (docId: string, fecha: string, outstanding: number) => ({
  id: docId,
  document_type: "invoice",
  numero: 7,
  punto_venta: 2,
  letter: "A",
  kind: "factura",
  fecha,
  imp_total: outstanding,
  already_allocated: 0,
  outstanding,
  currency: "ARS",
  check_number: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  listAccountsAction.mockResolvedValue({
    ok: true,
    data: [
      account(GALICIA, "Banco Galicia", "bank"),
      account(CAJA, "Caja", "cash"),
      account(CARTERA, "Cheques en cartera", "checks"),
      account(DOLARES, "Caja dólares", "cash", "USD"),
    ],
  });
  searchClientsAction.mockResolvedValue({
    ok: true,
    data: {
      clients: [
        { id: CLIENT, legal_name: "Cliente Uno SA", cuit: "30111111118" },
      ],
    },
  });
  searchSuppliersAction.mockResolvedValue({
    ok: true,
    data: {
      suppliers: [{ id: SUPPLIER, legal_name: "Gomería Sur", cuit: null }],
    },
  });
  readInvoicingChannels.mockResolvedValue({
    ok: true,
    channels: [FISCAL, INTERNAL],
  });
  listPendingComprobantesForClientAction.mockImplementation(
    async (_client: string, channel: string) => ({
      ok: true,
      data:
        channel === FISCAL.id
          ? [
              pendingInvoice(FC2, "2026-10-01", 80_000),
              pendingInvoice(FC1, "2026-09-01", 50_000),
            ]
          : [],
    }),
  );
  getNextReceiptNumeroAction.mockResolvedValue({
    ok: true,
    data: { next: 41, isFirst: false },
  });
  getReceiptUsdRateAction.mockResolvedValue({ ok: true, data: null });
  listPendingInvoicesForSupplierAction.mockResolvedValue({
    ok: true,
    data: [],
  });
  getNextPaymentOrderNumeroAction.mockResolvedValue({
    ok: true,
    data: { next: 9, isFirst: false },
  });
});

describe("proposeReceipt", () => {
  it("picks the channel with open comprobantes and applies oldest first", async () => {
    const prepared = await proposeReceipt.proposal?.prepareDraft(ctx, {
      client: "Cliente Uno",
      amount: 100_000,
      account: "galicia",
      receipt_date: "2026-11-05",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      channel_id: FISCAL.id,
      numero: 41,
      client_id: CLIENT,
      total_amount: 100_000,
      currency: "ARS",
      allocation_mode: "manual",
      allocations: [
        { invoice_id: FC1, amount_applied: 50_000 },
        { invoice_id: FC2, amount_applied: 50_000 },
      ],
      payment_lines: [{ account_id: GALICIA, amount: 100_000 }],
      retentions: [],
    });
    expect(prepared.summary).toContainEqual({
      label: "Imputa a FC A 0002-00000007 del 1 sep 2026",
      value: expect.stringContaining("50.000"),
    });
  });

  it("asks fiscal or internal when neither channel has anything open", async () => {
    listPendingComprobantesForClientAction.mockResolvedValue({
      ok: true,
      data: [],
    });
    const prepared = await proposeReceipt.proposal?.prepareDraft(ctx, {
      client: "Cliente Uno",
      amount: 1000,
      account: "Caja",
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "channel" }],
      candidates: [
        {
          field: "channel",
          options: [
            { value: "fiscal", label: FISCAL.name },
            { value: "internal", label: INTERNAL.name },
          ],
        },
      ],
    });
  });

  it("holds the whole amount a cuenta when asked", async () => {
    const prepared = await proposeReceipt.proposal?.prepareDraft(ctx, {
      client: "Cliente Uno",
      amount: 1000,
      account: "Caja",
      channel: "fiscal",
      allocation: "a_cuenta",
    });
    expect(prepared).toMatchObject({
      kind: "draft",
      draft: { allocation_mode: "a_cuenta", allocations: [] },
    });
  });

  it("asks for the check's data on a check account", async () => {
    const prepared = await proposeReceipt.proposal?.prepareDraft(ctx, {
      client: "Cliente Uno",
      amount: 1000,
      account: "Cheques en cartera",
      channel: "fiscal",
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "check" }],
    });
  });

  it("asks for the USD rate when none is loaded", async () => {
    const prepared = await proposeReceipt.proposal?.prepareDraft(ctx, {
      client: "Cliente Uno",
      amount: 1000,
      account: "Caja dólares",
      channel: "fiscal",
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "cotizacion" }],
    });
  });

  it("accepting issues the receipt through the command, with the pending re-read", async () => {
    createReceipt.mockResolvedValue({
      ok: true,
      data: { id: id(99), numero: 41, punto_venta: 2 },
    });
    const prepared = await proposeReceipt.proposal?.prepareDraft(ctx, {
      client: "Cliente Uno",
      amount: 100_000,
      account: "Banco Galicia",
    });
    if (prepared?.kind !== "draft") throw new Error("no draft");
    const res = await proposeReceipt.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res).toEqual({
      ok: true,
      data: { id: id(99), note: "Recibo X0002-00000041 emitido." },
    });
    expect(createReceipt).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ client_id: CLIENT }),
      listPendingComprobantesForClientAction,
    );
  });
});

describe("proposePaymentOrder", () => {
  it("drafts an OP a cuenta when the supplier has nothing open", async () => {
    const prepared = await proposePaymentOrder.proposal?.prepareDraft(ctx, {
      supplier: "Gomería Sur",
      amount: 25_000,
      account: "Banco Galicia",
      channel: "internal",
      payment_date: "2026-11-05",
    });
    expect(prepared).toMatchObject({
      kind: "draft",
      draft: {
        channel_id: INTERNAL.id,
        numero: 9,
        supplier_id: SUPPLIER,
        allocation_mode: "a_cuenta",
        payment_lines: [
          { line_kind: "account", account_id: GALICIA, amount: 25_000 },
        ],
      },
    });
  });

  it("does not offer a check account to pay from", async () => {
    const prepared = await proposePaymentOrder.proposal?.prepareDraft(ctx, {
      supplier: "Gomería Sur",
      amount: 25_000,
      account: "Cheques en cartera",
      channel: "fiscal",
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "account" }],
    });
  });
});

describe("proposeCashMovement", () => {
  it("drafts the movement in the account's currency and month", async () => {
    const prepared = await proposeCashMovement.proposal?.prepareDraft(ctx, {
      kind: "expense",
      amount: 5000,
      account: "Caja",
      transaction_date: "2026-11-04",
      description: "Insumos de limpieza",
      channel: "fiscal",
    });
    expect(prepared).toMatchObject({
      kind: "draft",
      draft: {
        account_id: CAJA,
        channel_id: FISCAL.id,
        kind: "expense",
        currency: "ARS",
        accrual_month: "2026-11-01",
      },
    });
    if (prepared?.kind !== "draft") return;
    expect(prepared.summary).toContainEqual({
      label: "Mes devengado",
      value: "nov 2026",
    });
  });

  it("asks the channel when there are two and the user named none", async () => {
    const prepared = await proposeCashMovement.proposal?.prepareDraft(ctx, {
      kind: "income",
      amount: 5000,
      account: "Caja",
      description: "Venta de chatarra",
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "channel" }],
    });
  });
});

describe("proposeTransfer", () => {
  it("refuses accounts in different currencies", async () => {
    const prepared = await proposeTransfer.proposal?.prepareDraft(ctx, {
      from: "Caja dólares",
      to: "Banco Galicia",
      amount: 100,
      channel: "fiscal",
    });
    expect(prepared).toEqual({
      kind: "error",
      error: "Moneda incompatible: USD → ARS.",
    });
  });

  it("accepting writes both legs through the command", async () => {
    createTransfer.mockResolvedValue({
      ok: true,
      data: { transfer_out_id: id(50), transfer_in_id: id(51) },
    });
    const prepared = await proposeTransfer.proposal?.prepareDraft(ctx, {
      from: "Banco Galicia",
      to: "Caja",
      amount: 200_000,
      channel: "fiscal",
    });
    if (prepared?.kind !== "draft") throw new Error("no draft");
    const res = await proposeTransfer.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res).toEqual({ ok: true, data: { id: id(50) } });
    expect(createTransfer).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        account_from_id: GALICIA,
        account_to_id: CAJA,
        amount: 200_000,
      }),
    );
  });
});
