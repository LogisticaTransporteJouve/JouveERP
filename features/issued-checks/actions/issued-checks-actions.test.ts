import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const h = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
}));

function fakeClient() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: h.current, error: null }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        h.updates.push(values);
        return {
          eq: () => ({
            select: async () => ({ data: [{ id: "c1" }], error: null }),
          }),
        };
      },
      insert: (values: Record<string, unknown>) => {
        h.inserts.push(values);
        return {
          select: () => ({
            single: async () => ({ data: { id: "c1" }, error: null }),
          }),
        };
      },
    }),
  };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeClient(),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { createIssuedCheckAction, updateIssuedCheckAction } =
  await import("./issued-checks-actions");

const ID = "00000000-0000-4000-8000-000000000001";
const OP = "00000000-0000-4000-8000-000000000002";
const BANK = "00000000-0000-4000-8000-000000000003";

const handLoaded = {
  payment_order_id: null,
  amount: 100,
  currency: "ARS",
  bank_account_id: BANK,
  status: "emitted",
};

beforeEach(() => {
  h.current = { ...handLoaded };
  h.updates = [];
  h.inserts = [];
});

describe("updateIssuedCheckAction", () => {
  it("refuses to change the amount of a cashed check", async () => {
    h.current = { ...handLoaded, status: "cashed" };
    const res = await updateIssuedCheckAction({ id: ID, amount: 150 });
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("still edits the note of a cashed check", async () => {
    h.current = { ...handLoaded, status: "cashed" };
    const res = await updateIssuedCheckAction({
      id: ID,
      amount: 100,
      notes: "nota",
    });
    expect(res.ok).toBe(true);
  });

  it("changes the amount of an emitted check", async () => {
    const res = await updateIssuedCheckAction({ id: ID, amount: 150 });
    expect(res.ok).toBe(true);
    expect(h.updates[0]).toMatchObject({ amount: 150 });
  });

  it("refuses to attach a payment order to a hand-loaded check", async () => {
    const res = await updateIssuedCheckAction({
      id: ID,
      payment_order_id: OP,
    });
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("never writes payment_order_id", async () => {
    const res = await updateIssuedCheckAction({
      id: ID,
      payment_order_id: null,
      notes: "x",
    });
    expect(res.ok).toBe(true);
    expect(h.updates[0]).not.toHaveProperty("payment_order_id");
  });
});

describe("createIssuedCheckAction", () => {
  const input = {
    kind: "fisico",
    check_number: "123",
    bank_name: "Banco",
    issue_date: "2026-11-01",
    due_date: "2026-11-30",
    amount: 100,
    currency: "ARS",
    bank_account_id: BANK,
    channel_id: "jouve_fiscal",
  };

  it("refuses a hand-loaded check linked to a payment order", async () => {
    const res = await createIssuedCheckAction({
      ...input,
      payment_order_id: OP,
    });
    expect(res.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  it("creates it without a payment order", async () => {
    const res = await createIssuedCheckAction(input);
    expect(res.ok).toBe(true);
    expect(h.inserts[0]).not.toHaveProperty("payment_order_id");
  });
});
