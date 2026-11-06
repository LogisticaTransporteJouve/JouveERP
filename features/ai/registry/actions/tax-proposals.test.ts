import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listTaxAccountOptionsAction = vi.fn();
const listTaxDocumentsAction = vi.fn();
const listAccountsAction = vi.fn();
const payTaxDocument = vi.fn();

vi.mock("@/features/taxes/actions/tax-documents-actions", () => ({
  listTaxAccountOptionsAction,
  listTaxDocumentsAction,
}));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction,
}));
vi.mock("@/lib/commands/pay-tax-document", () => ({ payTaxDocument }));
vi.mock("@/lib/format", async (orig) => ({
  ...(await orig<typeof import("@/lib/format")>()),
  todayInAR: () => "2026-11-06",
}));

const { proposeTaxDocument, proposeTaxPayment } =
  await import("./tax-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };
const DOC = "00000000-0000-4000-8000-000000000001";
const IVA_ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
const BANK = "00000000-0000-4000-8000-0000000000b1";

const doc = {
  id: DOC,
  kind: "iibb",
  title: null,
  jurisdiction: "Buenos Aires",
  period: "2026-10",
  due_date: "2026-11-15",
  amount: 120000,
  amount_is_estimate: false,
  status: "pendiente",
  account_id: IVA_ACCOUNT,
  account_name: "2.1.05 IIBB a pagar",
  payment_transaction_id: null,
  payment_origin: null,
  paid_date: null,
  paid_amount: null,
  paid_from: null,
  credit_balance: null,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  listTaxAccountOptionsAction.mockResolvedValue({
    ok: true,
    data: [
      {
        id: IVA_ACCOUNT,
        label: "2.1.03 IVA débito fiscal",
        system_role: "iva_debito",
      },
    ],
  });
  listTaxDocumentsAction.mockResolvedValue({ ok: true, data: [doc] });
  listAccountsAction.mockResolvedValue({
    ok: true,
    data: [
      {
        id: BANK,
        name: "Banco Galicia",
        type: "bank",
        currency: "ARS",
        is_active: true,
      },
      {
        id: "usd",
        name: "Banco Galicia USD",
        type: "bank",
        currency: "USD",
        is_active: true,
      },
    ],
  });
});

describe("proposeTaxDocument", () => {
  it("takes the kind's usual account and no amount the user did not give", async () => {
    const prepared = await proposeTaxDocument.proposal?.prepareDraft(ctx, {
      kind: "iva",
      period: "2026-10",
      due_date: "2026-11-18",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      kind: "iva",
      amount: null,
      account_id: IVA_ACCOUNT,
    });
  });

  it("holds an 'otro' to the form's rule: it needs a name", async () => {
    const prepared = await proposeTaxDocument.proposal?.prepareDraft(ctx, {
      kind: "otro",
      period: "2026-10",
      due_date: "2026-11-18",
    });
    expect(prepared?.kind).toBe("issues");
  });
});

describe("proposeTaxPayment", () => {
  const prepare = (input: Record<string, unknown> = {}) =>
    proposeTaxPayment.proposal?.prepareDraft(ctx, {
      tax_document_id: DOC,
      account: "galicia",
      ...input,
    });

  it("pays the document's amount from the peso account named", async () => {
    // "galicia" matches two accounts, but only one is in pesos.
    const prepared = await prepare();
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toEqual({
      id: DOC,
      paid_date: "2026-11-06",
      account_id: BANK,
      amount: 120000,
    });
  });

  it("refuses a document already paid", async () => {
    listTaxDocumentsAction.mockResolvedValue({
      ok: true,
      data: [{ ...doc, status: "pagado" }],
    });
    expect(await prepare()).toEqual({
      kind: "error",
      error: "Ese impuesto ya está pagado.",
    });
  });

  it("asks for the amount when the document has none", async () => {
    listTaxDocumentsAction.mockResolvedValue({
      ok: true,
      data: [{ ...doc, amount: null }],
    });
    expect((await prepare())?.kind).toBe("issues");
  });

  it("is offered only with the page's gate for «Pagar»", () => {
    expect(proposeTaxPayment.permissions).toEqual(
      expect.arrayContaining(["taxes:write", "transactions:write"]),
    );
  });

  it("pays through the page's command on accept", async () => {
    payTaxDocument.mockResolvedValue({
      ok: true,
      data: { transactionId: "tx-1" },
    });
    const prepared = await prepare();
    if (prepared?.kind !== "draft") throw new Error("expected a draft");
    expect(
      await proposeTaxPayment.proposal?.executeDraft(ctx, prepared.draft),
    ).toEqual({ ok: true, data: { id: DOC } });
    expect(payTaxDocument).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ id: DOC, account_id: BANK }),
    );
  });
});
