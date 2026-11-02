import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

type Result = { data?: unknown; count?: number | null; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

let roles: Role[] = ["fiscal_reader"];
let results: Record<string, Result[]> = {};
let calls: Call[] = [];

function builder(table: string): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const next = results[table]?.shift() ?? {
            data: null,
            count: 0,
            error: null,
          };
          return (resolve: (value: Result) => unknown) =>
            Promise.resolve(next).then(resolve);
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(prop), args });
          return chain;
        };
      },
    },
  );
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: (table: string) => builder(table),
    rpc: (fn: string) => builder(`rpc:${fn}`),
  }),
}));

const { getMonthlyPackageStatusAction } =
  await import("./monthly-package-actions");

beforeEach(() => {
  roles = ["fiscal_reader"];
  results = {};
  calls = [];
});

describe("getMonthlyPackageStatusAction", () => {
  it("refuses a role without accounting:read before reading", async () => {
    roles = ["operations"];
    const res = await getMonthlyPackageStatusAction("2026-10");
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("rejects a malformed period", async () => {
    const res = await getMonthlyPackageStatusAction("2026-10-01");
    expect(res.ok).toBe(false);
  });

  it("counts the month for a fiscal_reader, fiscal invoices only", async () => {
    results.accounting_closed_periods = [
      { data: { closed_at: "2026-11-01T12:00:00Z" }, error: null },
    ];
    results.pending_journal_entries = [{ count: 2, error: null }];
    results["rpc:journal_missing_entries"] = [
      { data: [{ source_id: "a" }], error: null },
    ];
    results.invoices = [
      { count: 1, error: null },
      { count: 0, error: null },
      { count: 3, error: null },
      { count: 0, error: null },
    ];
    results["rpc:purchase_invoices_fiscal_without_letter"] = [
      {
        data: [
          { fecha: "2026-10-05", status: "received" },
          { fecha: "2026-10-06", status: "cancelled" },
          { fecha: "2026-09-30", status: "received" },
        ],
        error: null,
      },
    ];
    const res = await getMonthlyPackageStatusAction("2026-10");
    expect(res).toEqual({
      ok: true,
      data: {
        period: "2026-10",
        closedAt: "2026-11-01T12:00:00Z",
        closedReadFailed: false,
        pendingJournal: 2,
        missingJournal: 1,
        invoicesDraft: 1,
        invoicesEmitting: 0,
        invoicesFailed: 3,
        caeaUninformed: 0,
        purchasesWithoutLetter: 1,
      },
    });
    expect(calls).toContainEqual({
      table: "invoices",
      method: "eq",
      args: ["channel.is_fiscal", true],
    });
    expect(calls).toContainEqual({
      table: "invoices",
      method: "lte",
      args: ["fecha", "2026-10-31"],
    });
  });

  it("reports an unread check as null, not zero", async () => {
    results.pending_journal_entries = [
      { count: null, error: { message: "boom" } },
    ];
    results.accounting_closed_periods = [
      { data: null, error: { message: "boom" } },
    ];
    const res = await getMonthlyPackageStatusAction("2026-10");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.pendingJournal).toBeNull();
    expect(res.data.closedReadFailed).toBe(true);
    expect(res.data.closedAt).toBeNull();
  });
});
