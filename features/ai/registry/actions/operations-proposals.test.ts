import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listLateInterestCandidatesAction = vi.fn();
const searchClientsAction = vi.fn();
const listReconciliationAccountsAction = vi.fn();
const getReconciliationAction = vi.fn();
const issueLateInterestNd = vi.fn();
const matchBankLines = vi.fn();

vi.mock("@/features/late-interest/actions/late-interest-actions", () => ({
  listLateInterestCandidatesAction,
}));
vi.mock("@/features/clients/actions/clients-actions", () => ({
  searchClientsAction,
}));
vi.mock(
  "@/features/bank-reconciliation/actions/reconciliation-actions",
  () => ({
    listReconciliationAccountsAction,
    getReconciliationAction,
  }),
);
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/commands/issue-late-interest-nd", () => ({
  issueLateInterestNd,
}));
vi.mock("@/lib/commands/match-bank-line", () => ({ matchBankLines }));
vi.mock("@/lib/commands/create-task", () => ({ createTask: vi.fn() }));

const { proposeBankMatches, proposeLateInterestNd } =
  await import("./operations-proposals");

const ctx = { userId: "u1", access: resolveAccess(["owner"]) };
const INVOICE = "00000000-0000-4000-8000-000000000001";

const candidate = {
  invoice_id: INVOICE,
  client_id: "c1",
  client_name: "Cliente Uno",
  channel_id: "jouve_fiscal",
  channel_is_fiscal: true,
  kind: "factura",
  letter: "A",
  punto_venta: 2,
  numero: 10,
  fecha: "2026-09-01",
  due_date: "2026-09-30",
  moneda: "PES",
  open_amount: 100_000,
  balance_days: 3_000_000,
  charged_to: null,
  charge_from: "2026-10-01",
  client_rate: null,
  monthly_rate: 3,
  days: 0,
  interest: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  listLateInterestCandidatesAction.mockResolvedValue({
    ok: true,
    data: [candidate],
  });
});

describe("proposeLateInterestNd", () => {
  it("drafts the ND with the interest it would charge and the PV of the comprobante", async () => {
    const prepared = await proposeLateInterestNd.proposal?.prepareDraft(ctx, {
      invoice_id: INVOICE,
      as_of: "2026-10-30",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    // 100.000 × 3 % / 30 × 30 days
    expect(prepared.draft).toEqual({
      invoice_id: INVOICE,
      as_of: "2026-10-30",
      monthly_rate: 3,
      punto_venta: 2,
      expected_interest: 3000,
    });
    expect(prepared.summary.map((r) => r.label)).toContain("Qué pasa");
  });

  it("asks for a rate when neither the client nor the general one is set", async () => {
    listLateInterestCandidatesAction.mockResolvedValue({
      ok: true,
      data: [{ ...candidate, monthly_rate: null }],
    });
    const prepared = await proposeLateInterestNd.proposal?.prepareDraft(ctx, {
      invoice_id: INVOICE,
      as_of: "2026-10-30",
    });
    expect(prepared?.kind).toBe("issues");
  });

  it("issues with the interest the card showed, so a changed balance is refused", async () => {
    issueLateInterestNd.mockResolvedValue({
      ok: true,
      data: { invoiceId: "nd1" },
    });
    const res = await proposeLateInterestNd.proposal?.executeDraft(ctx, {
      invoice_id: INVOICE,
      as_of: "2026-10-30",
      monthly_rate: 3,
      punto_venta: 2,
      expected_interest: 3000,
    });
    expect(res).toEqual({ ok: true, data: { id: "nd1" } });
    expect(issueLateInterestNd).toHaveBeenCalledWith(
      "u1",
      {
        invoice_id: INVOICE,
        as_of: "2026-10-30",
        monthly_rate: 3,
        punto_venta: 2,
      },
      expect.any(Function),
      3000,
    );
  });
});

describe("proposeBankMatches", () => {
  const ACCOUNT = "33333333-3333-4333-8333-333333333333";
  const LINE = "44444444-4444-4444-8444-444444444444";
  const TX = "55555555-5555-4555-8555-555555555555";

  beforeEach(() => {
    listReconciliationAccountsAction.mockResolvedValue({
      ok: true,
      data: [
        { id: ACCOUNT, name: "Banco Galicia", type: "bank", currency: "ARS" },
      ],
    });
    getReconciliationAction.mockResolvedValue({
      ok: true,
      data: {
        lines: [
          {
            id: LINE,
            line_date: "2026-10-01",
            description: "Cobro",
            amount: 1000,
          },
        ],
        movements: [
          { id: TX, transaction_date: "2026-10-01", description: "Recibo 1" },
        ],
        suggestions: [
          {
            line_id: LINE,
            transaction_id: TX,
            days: 0,
            reference_match: false,
          },
        ],
      },
    });
  });

  it("proposes exactly the page's suggestions", async () => {
    const prepared = await proposeBankMatches.proposal?.prepareDraft(ctx, {
      account: "galicia",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toEqual({
      account_id: ACCOUNT,
      matches: [{ line_id: LINE, transaction_ids: [TX] }],
    });
  });

  it("fails when no line went through and reports skipped ones", async () => {
    const draft = {
      account_id: ACCOUNT,
      matches: [{ line_id: LINE, transaction_ids: [TX] }],
    };
    matchBankLines.mockResolvedValue({
      matched: 0,
      failed: [{ line_id: LINE, error: "La línea ya está conciliada" }],
    });
    expect(await proposeBankMatches.proposal?.executeDraft(ctx, draft)).toEqual(
      {
        ok: false,
        error: "La línea ya está conciliada",
      },
    );
  });
});
