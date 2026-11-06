import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listAccountsAction = vi.fn();
const createAccount = vi.fn();

vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction,
}));
vi.mock("@/lib/commands/create-account", async (orig) => ({
  ...(await orig<typeof import("@/lib/commands/create-account")>()),
  createAccount,
}));

const { proposeTreasuryAccount } = await import("./account-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };
const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";

const prepare = (input: Record<string, unknown>) =>
  proposeTreasuryAccount.proposal?.prepareDraft(ctx, input);

beforeEach(() => {
  vi.clearAllMocks();
  listAccountsAction.mockResolvedValue({
    ok: true,
    data: [
      { name: "Banco Galicia", type: "bank", currency: "ARS", is_active: true },
      { name: "Caja vieja", type: "cash", currency: "ARS", is_active: false },
    ],
  });
});

describe("proposeTreasuryAccount", () => {
  it("drafts the form's fields, parsing an es-AR saldo inicial", async () => {
    const prepared = await prepare({
      name: "Banco Nación",
      type: "bank",
      opening_balance: "1.500.000,50",
    });
    if (prepared?.kind !== "draft") throw new Error("expected a draft");
    expect(prepared.draft).toEqual({
      name: "Banco Nación",
      type: "bank",
      currency: "ARS",
      opening_balance: 1_500_000.5,
      notes: null,
    });
    expect(prepared.summary).toEqual(
      expect.arrayContaining([
        { label: "Nombre", value: "Banco Nación" },
        { label: "Tipo", value: "Cuenta bancaria" },
        { label: "Moneda", value: "ARS" },
      ]),
    );
    expect(
      prepared.summary.find((r) => r.label === "Saldo inicial")?.value,
    ).toMatch(/1\.500\.000,50/);
  });

  it("keeps a negative saldo inicial and defaults it to 0", async () => {
    const negative = await prepare({
      name: "Banco Nación",
      type: "bank",
      opening_balance: "-2.000",
    });
    if (negative?.kind !== "draft") throw new Error("expected a draft");
    expect(negative.draft).toMatchObject({ opening_balance: -2000 });

    const none = await prepare({ name: "Caja chica", type: "cash" });
    if (none?.kind !== "draft") throw new Error("expected a draft");
    expect(none.draft).toMatchObject({ opening_balance: 0 });
  });

  it("refuses a saldo inicial that is not a number", async () => {
    const prepared = await prepare({
      name: "Banco Nación",
      type: "bank",
      opening_balance: "12abc",
    });
    expect(prepared).toEqual({
      kind: "issues",
      issues: [
        { field: "opening_balance", message: "Saldo inicial inválido." },
      ],
    });
  });

  it("asks for the type when the user did not say it", async () => {
    const prepared = await prepare({ name: "Banco Nación" });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "type" }],
      candidates: [
        {
          field: "type",
          options: expect.arrayContaining([
            { value: "bank", label: "Cuenta bancaria" },
            { value: "cash", label: "Efectivo" },
          ]),
        },
      ],
    });
  });

  it("refuses an active account with the same name, type and currency", async () => {
    const prepared = await prepare({ name: "banco galicia", type: "bank" });
    expect(prepared).toEqual({
      kind: "error",
      error: "Ya existe una cuenta con ese nombre, tipo y moneda.",
    });
  });

  it("allows the name in another currency or over an inactive account", async () => {
    const usd = await prepare({
      name: "Banco Galicia",
      type: "bank",
      currency: "USD",
    });
    expect(usd?.kind).toBe("draft");
    const reused = await prepare({ name: "Caja vieja", type: "cash" });
    expect(reused?.kind).toBe("draft");
  });

  it("creates through the form's command on accept", async () => {
    createAccount.mockResolvedValue({ ok: true, data: { id: ACCOUNT } });
    const prepared = await prepare({
      name: "Caja chica",
      type: "cash",
      currency: "USD",
      opening_balance: 300,
    });
    if (prepared?.kind !== "draft") throw new Error("expected a draft");
    const res = await proposeTreasuryAccount.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res).toEqual({ ok: true, data: { id: ACCOUNT } });
    expect(createAccount).toHaveBeenCalledWith("u1", {
      name: "Caja chica",
      type: "cash",
      currency: "USD",
      opening_balance: 300,
      notes: null,
    });
  });

  it("is offered only with accounts:write", () => {
    expect(proposeTreasuryAccount.permissions).toEqual([
      "accounts:write",
      "accounts:read",
    ]);
  });
});
