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
const listEnCarteraChecksAction = vi.fn();
const getReceiptByIdAction = vi.fn();
const getReceiptEmailDefaultsAction = vi.fn();
const sendReceiptEmail = vi.fn();

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
  getReceiptByIdAction,
  getReceiptUsdRateAction,
}));
vi.mock("@/features/receipts/actions/send-receipt-email", () => ({
  getReceiptEmailDefaultsAction,
}));
vi.mock("@/features/checks/actions/checks-actions", () => ({
  listEnCarteraChecksAction,
}));
vi.mock("@/lib/commands/send-receipt-email", () => ({ sendReceiptEmail }));
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
  proposeReceiptEmail,
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
const CHECK = id(20);
const RECEIPT = id(30);

const carteraCheck = (overrides: Record<string, unknown> = {}) => ({
  id: CHECK,
  kind: "fisico",
  check_number: "00012345",
  bank_name: "Banco Nación",
  drawer_name: "Transportes Norte SA",
  due_date: "2026-12-01",
  amount: 30_000,
  currency: "ARS",
  cartera_account_id: CARTERA,
  cartera_account_name: "Cheques en cartera",
  channel_id: null,
  ...overrides,
});

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
      suppliers: [
        { id: SUPPLIER, legal_name: "Gomería Sur", cuit: "30222222229" },
      ],
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
  listEnCarteraChecksAction.mockResolvedValue({
    ok: true,
    data: [carteraCheck()],
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
      label: "Imputa a FC A 0002-00000007 del 01-09-2026",
      value: expect.stringContaining("50.000"),
    });
  });

  it("adds the retentions to the total and applies all of it", async () => {
    const prepared = await proposeReceipt.proposal?.prepareDraft(ctx, {
      client: "Cliente Uno",
      amount: 98_000,
      account: "Banco Galicia",
      receipt_date: "2026-11-05",
      retentions: [
        {
          tax_type: "ganancias",
          certificate_number: "0001-00001234",
          amount: 2000,
        },
        {
          kind: "percepcion",
          tax_type: "iibb",
          jurisdiction: "Santa Fe",
          certificate_number: "77",
          certificate_date: "2026-11-04",
          amount: 500.5,
        },
      ],
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      channel_id: FISCAL.id,
      total_amount: 100_500.5,
      payment_lines: [{ account_id: GALICIA, amount: 98_000 }],
      allocations: [
        { invoice_id: FC1, amount_applied: 50_000 },
        { invoice_id: FC2, amount_applied: 50_500.5 },
      ],
      retentions: [
        {
          kind: "retencion",
          tax_type: "ganancias",
          jurisdiction: null,
          certificate_number: "0001-00001234",
          certificate_date: "2026-11-05",
          amount: 2000,
        },
        {
          kind: "percepcion",
          tax_type: "iibb",
          jurisdiction: "Santa Fe",
          certificate_date: "2026-11-04",
          amount: 500.5,
        },
      ],
    });
    expect(prepared.summary).toContainEqual({
      label: "Retención Ganancias",
      value: expect.stringContaining("cert. 0001-00001234"),
    });
  });

  it("refuses retentions on an internal receipt, as the form", async () => {
    const prepared = await proposeReceipt.proposal?.prepareDraft(ctx, {
      client: "Cliente Uno",
      amount: 1000,
      account: "Caja",
      channel: "internal",
      retentions: [{ tax_type: "iva", certificate_number: "1", amount: 100 }],
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "retentions" }],
    });
  });

  it("refuses retentions without retentions:write", async () => {
    const prepared = await proposeReceipt.proposal?.prepareDraft(
      {
        userId: "u2",
        access: resolveAccess(["finance"], ["retentions:write"]),
      },
      {
        client: "Cliente Uno",
        amount: 1000,
        account: "Caja",
        retentions: [{ tax_type: "iva", certificate_number: "1", amount: 100 }],
      },
    );
    expect(prepared).toEqual({
      kind: "error",
      error: "No tenés permiso para cargar o editar retenciones.",
    });
    expect(listPendingComprobantesForClientAction).not.toHaveBeenCalled();
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

describe("proposePaymentOrder with checks", () => {
  it("endorses a cartera check for its amount and issues one of ours", async () => {
    const prepared = await proposePaymentOrder.proposal?.prepareDraft(ctx, {
      supplier: "Gomería Sur",
      amount: 20_000,
      account: "Caja",
      endorse_checks: [{ number: "12345" }],
      issue_checks: [
        {
          account: "Banco Galicia",
          number: "777",
          amount: 50_000,
          due_date: "2026-11-30",
          kind: "echeq",
        },
      ],
      channel: "fiscal",
      payment_date: "2026-11-05",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      total_amount: 100_000,
      currency: "ARS",
      payment_lines: [
        { line_kind: "account", account_id: CAJA, amount: 20_000 },
        {
          line_kind: "endorse_check",
          endorsed_check_id: CHECK,
          amount: 30_000,
        },
        {
          line_kind: "issue_check",
          account_id: GALICIA,
          amount: 50_000,
          issued_check: {
            kind: "echeq",
            check_number: "777",
            bank_name: "Banco Galicia",
            due_date: "2026-11-30",
            issue_date: "2026-11-05",
            beneficiary_name: "Gomería Sur",
            beneficiary_cuit: "30222222229",
          },
        },
      ],
    });
    expect(prepared.summary).toContainEqual({
      label:
        "Pagado desde cheque Nº 00012345 · Banco Nación · librador Transportes Norte SA",
      value: expect.stringContaining("30.000"),
    });
    expect(prepared.summary).toContainEqual({
      label: "Cheque propio Nº 777",
      value: expect.stringContaining("Banco Galicia"),
    });
  });

  it("takes the channel of the endorsed check when the user named none", async () => {
    listEnCarteraChecksAction.mockResolvedValue({
      ok: true,
      data: [carteraCheck({ channel_id: INTERNAL.id })],
    });
    const prepared = await proposePaymentOrder.proposal?.prepareDraft(ctx, {
      supplier: "Gomería Sur",
      endorse_checks: [{ number: "12345" }],
    });
    expect(prepared).toMatchObject({
      kind: "draft",
      draft: { channel_id: INTERNAL.id, total_amount: 30_000 },
    });
  });

  it("refuses a check of another channel", async () => {
    listEnCarteraChecksAction.mockResolvedValue({
      ok: true,
      data: [carteraCheck({ channel_id: INTERNAL.id })],
    });
    const prepared = await proposePaymentOrder.proposal?.prepareDraft(ctx, {
      supplier: "Gomería Sur",
      endorse_checks: [{ number: "12345" }],
      channel: "fiscal",
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "endorse_checks" }],
    });
  });

  it("refuses the same check twice and means in two currencies", async () => {
    const twice = await proposePaymentOrder.proposal?.prepareDraft(ctx, {
      supplier: "Gomería Sur",
      endorse_checks: [{ number: "12345" }, { number: "12345" }],
      channel: "fiscal",
    });
    expect(twice).toMatchObject({
      kind: "issues",
      issues: [{ field: "endorse_checks.1.number" }],
    });
    const mixed = await proposePaymentOrder.proposal?.prepareDraft(ctx, {
      supplier: "Gomería Sur",
      amount: 100,
      account: "Caja dólares",
      endorse_checks: [{ number: "12345" }],
      channel: "fiscal",
    });
    expect(mixed).toMatchObject({
      kind: "issues",
      issues: [{ field: "currency" }],
    });
  });

  it("asks how it is paid when nothing is given", async () => {
    const prepared = await proposePaymentOrder.proposal?.prepareDraft(ctx, {
      supplier: "Gomería Sur",
      channel: "fiscal",
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "account" }],
    });
  });
});

describe("proposeReceiptEmail", () => {
  const defaults = (recipient: string | null) => ({
    ok: true,
    data: {
      recipient,
      subject: "Recibo X0002-00000041",
      numero_label: "X0002-00000041",
      client_legal_name: "Cliente Uno SA",
      last_sent_at: null,
    },
  });
  const receipt = (status: string) => ({
    ok: true,
    data: { receipt: { id: RECEIPT, status } },
  });

  it("drafts the email to the client's address and sends it on accept", async () => {
    getReceiptByIdAction.mockResolvedValue(receipt("issued"));
    getReceiptEmailDefaultsAction.mockResolvedValue(
      defaults("pagos@cliente.com"),
    );
    sendReceiptEmail.mockResolvedValue({ ok: true, data: { log_id: "l1" } });
    const prepared = await proposeReceiptEmail.proposal?.prepareDraft(ctx, {
      receipt_id: RECEIPT,
    });
    if (prepared?.kind !== "draft") throw new Error("no draft");
    expect(prepared.draft).toEqual({
      receipt_id: RECEIPT,
      recipient: "pagos@cliente.com",
      subject: "Recibo X0002-00000041",
      body: null,
    });
    expect(prepared.summary).toContainEqual({
      label: "Recibo",
      value: "X0002-00000041",
    });
    const res = await proposeReceiptEmail.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res).toEqual({
      ok: true,
      data: { id: RECEIPT, note: "Enviado a pagos@cliente.com." },
    });
    expect(sendReceiptEmail).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ receipt_id: RECEIPT }),
    );
  });

  it("asks for the address when the client has none", async () => {
    getReceiptByIdAction.mockResolvedValue(receipt("issued"));
    getReceiptEmailDefaultsAction.mockResolvedValue(defaults(null));
    const prepared = await proposeReceiptEmail.proposal?.prepareDraft(ctx, {
      receipt_id: RECEIPT,
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "recipient" }],
    });
  });

  it("refuses a canceled receipt", async () => {
    getReceiptByIdAction.mockResolvedValue(receipt("canceled"));
    const prepared = await proposeReceiptEmail.proposal?.prepareDraft(ctx, {
      receipt_id: RECEIPT,
    });
    expect(prepared).toEqual({
      kind: "error",
      error: "Solo se pueden enviar recibos emitidos.",
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
