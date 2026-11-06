import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listAccountsAction = vi.fn();
const listEnCarteraChecksAction = vi.fn();
const readInvoicingChannels = vi.fn();
const createManualCheck = vi.fn();
const depositCheck = vi.fn();
const createIssuedCheck = vi.fn();

vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction,
}));
vi.mock("@/features/checks/actions/checks-actions", () => ({
  listEnCarteraChecksAction,
}));
vi.mock("@/lib/channels", () => ({ readInvoicingChannels }));
vi.mock("@/lib/commands/create-manual-check", () => ({ createManualCheck }));
vi.mock("@/lib/commands/deposit-check", () => ({ depositCheck }));
vi.mock("@/lib/commands/create-issued-check", () => ({ createIssuedCheck }));

const { proposeCheckDeposit, proposeIssuedCheck, proposeManualCheck } =
  await import("./checks-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GALICIA = id(1);
const CARTERA = id(2);
const ECHEQS = id(3);
const NACION_USD = id(4);
const CHECK = id(10);
const OTHER_CHECK = id(11);

const account = (
  accountId: string,
  name: string,
  type: string,
  currency = "ARS",
) => ({ id: accountId, name, type, currency, is_active: true });

const carteraCheck = (
  checkId: string,
  bank: string,
  channel: string | null,
) => ({
  id: checkId,
  kind: "fisico",
  check_number: "00012345",
  bank_name: bank,
  drawer_name: "Cliente Uno SA",
  due_date: "2026-11-20",
  amount: 300_000,
  currency: "ARS",
  cartera_account_id: CARTERA,
  cartera_account_name: "Cheques en cartera",
  channel_id: channel,
});

beforeEach(() => {
  vi.clearAllMocks();
  listAccountsAction.mockResolvedValue({
    ok: true,
    data: [
      account(GALICIA, "Banco Galicia", "bank"),
      account(CARTERA, "Cheques en cartera", "checks"),
      account(ECHEQS, "E-cheqs", "echeq"),
      account(NACION_USD, "Banco Nación USD", "bank", "USD"),
    ],
  });
  readInvoicingChannels.mockResolvedValue({
    ok: true,
    channels: [
      { id: "jouve_fiscal", name: "Fiscal", is_fiscal: true, is_active: true },
      {
        id: "jouve_internal",
        name: "Interno",
        is_fiscal: false,
        is_active: true,
      },
    ],
  });
  listEnCarteraChecksAction.mockResolvedValue({
    ok: true,
    data: [carteraCheck(CHECK, "Banco Macro", "jouve_internal")],
  });
});

describe("proposeManualCheck", () => {
  it("loads a físico into the only físico cartera, in its currency", async () => {
    const prepared = await proposeManualCheck.proposal?.prepareDraft(ctx, {
      check_number: "12345",
      bank: "Macro",
      drawer: "Cliente Uno SA",
      amount: 300_000,
      issue_date: "2026-11-05",
      due_date: "2026-11-20",
      channel: "fiscal",
    });
    expect(prepared).toMatchObject({
      kind: "draft",
      draft: {
        kind: "fisico",
        cartera_account_id: CARTERA,
        currency: "ARS",
        channel_id: "jouve_fiscal",
        source_kind: "manual",
      },
    });
  });

  it("an e-cheq goes to the e-cheq cartera", async () => {
    const prepared = await proposeManualCheck.proposal?.prepareDraft(ctx, {
      kind: "echeq",
      check_number: "1",
      bank: "Macro",
      drawer: "X",
      amount: 10,
      due_date: "2026-11-20",
      channel: "fiscal",
    });
    expect(prepared).toMatchObject({
      kind: "draft",
      draft: { cartera_account_id: ECHEQS },
    });
  });
});

describe("proposeCheckDeposit", () => {
  it("finds the cartera check by number and keeps its channel", async () => {
    const prepared = await proposeCheckDeposit.proposal?.prepareDraft(ctx, {
      check_number: "12345",
      account: "Galicia",
      event_date: "2026-11-06",
    });
    expect(prepared).toMatchObject({
      kind: "draft",
      draft: {
        check_id: CHECK,
        account_id: GALICIA,
        channel_id: "jouve_internal",
      },
    });
  });

  it("asks the bank when two checks share the number", async () => {
    listEnCarteraChecksAction.mockResolvedValue({
      ok: true,
      data: [
        carteraCheck(CHECK, "Banco Macro", null),
        carteraCheck(OTHER_CHECK, "Banco Credicoop", null),
      ],
    });
    const prepared = await proposeCheckDeposit.proposal?.prepareDraft(ctx, {
      check_number: "12345",
      account: "Galicia",
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "bank" }],
    });
  });

  it("does not offer an account in another currency", async () => {
    const prepared = await proposeCheckDeposit.proposal?.prepareDraft(ctx, {
      check_number: "12345",
      account: "Banco Nación USD",
    });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "account" }],
    });
  });

  it("accepting deposits through the command", async () => {
    depositCheck.mockResolvedValue({ ok: true, data: { movement_id: "m1" } });
    const prepared = await proposeCheckDeposit.proposal?.prepareDraft(ctx, {
      check_number: "12345",
      account: "Galicia",
    });
    if (prepared?.kind !== "draft") throw new Error("no draft");
    const res = await proposeCheckDeposit.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res).toEqual({ ok: true, data: { id: CHECK } });
    expect(depositCheck).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ check_id: CHECK, account_id: GALICIA }),
    );
  });
});

describe("proposeIssuedCheck", () => {
  it("draws on a bank account, in its currency", async () => {
    const prepared = await proposeIssuedCheck.proposal?.prepareDraft(ctx, {
      check_number: "777",
      account: "Galicia",
      beneficiary: "Gomería Sur",
      amount: 50_000,
      due_date: "2026-12-01",
      channel: "fiscal",
    });
    expect(prepared).toMatchObject({
      kind: "draft",
      draft: {
        bank_account_id: GALICIA,
        bank_name: "Banco Galicia",
        beneficiary_name: "Gomería Sur",
        currency: "ARS",
        amount: 50_000,
      },
    });
  });
});
