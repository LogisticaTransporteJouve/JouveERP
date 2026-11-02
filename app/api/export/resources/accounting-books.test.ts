import { beforeEach, describe, expect, it, vi } from "vitest";

import { cellText, ExportInputError } from "../shared";

type Result = { data: unknown; error: unknown };

let entries: unknown[] = [];
let balancesByPeriod: Record<string, unknown[]> = {};
const rpcCalls: unknown[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: async (from: number): Promise<Result> => ({
          data: from === 0 ? entries : [],
          error: null,
        }),
      };
      return chain;
    },
    rpc: async (_fn: string, args: { p_period_end: string }) => {
      rpcCalls.push(args);
      return { data: balancesByPeriod[args.p_period_end] ?? [], error: null };
    },
  }),
}));

const { balanceSumasSaldos, libroDiario, libroMayor } =
  await import("./accounting-books");

const params = (period: string) => new URLSearchParams({ period });
const range = { from: null, to: null };

function entry(
  id: string,
  date: string,
  lines: [string, number, number][],
): unknown {
  return {
    id,
    entry_date: date,
    description: `Asiento ${id}`,
    created_at: `${date}T10:00:00Z`,
    lines: lines.map(([code, debit, credit], i) => ({
      debit,
      credit,
      description: null,
      sort_order: i,
      account: { code, name: `Cuenta ${code}` },
    })),
  };
}

beforeEach(() => {
  entries = [
    entry("e1", "2026-10-03", [
      ["1.1.1", 100, 0],
      ["4.1.1", 0, 100],
    ]),
    entry("e2", "2026-10-09", [
      ["1.1.1", 0, 30],
      ["5.1.1", 30, 0],
    ]),
  ];
  balancesByPeriod = {};
  rpcCalls.length = 0;
});

describe("accounting books exporters", () => {
  it("refuse a missing or malformed period", async () => {
    await expect(
      libroDiario.load(new URLSearchParams(), range),
    ).rejects.toThrow(ExportInputError);
    await expect(libroMayor.load(params("2026-1"), range)).rejects.toThrow(
      ExportInputError,
    );
  });

  it("libro diario lists every line numbered by entry, with balanced totals", async () => {
    const out = await libroDiario.load(params("2026-10"), range);
    expect(out.rows).toHaveLength(4);
    expect(out.rows.map((r) => cellText(r[0]!))).toEqual(["1", "1", "2", "2"]);
    expect(out.totalsRow?.slice(5).map(cellText)).toEqual([
      "$130,00",
      "$130,00",
    ]);
    expect(out.fileName).toBe("libro-diario-2026-10");
  });

  it("libro mayor runs each account from the previous period's balance", async () => {
    balancesByPeriod["2026-09"] = [
      {
        account_code: "1.1.1",
        account_name: "Caja",
        account_type: "activo",
        total_debit: 500,
        total_credit: 0,
        balance: 500,
      },
    ];
    const out = await libroMayor.load(params("2026-10"), range);
    expect(rpcCalls).toEqual([{ p_period_end: "2026-09" }]);
    const caja = out.rows
      .filter((r) => cellText(r[0]!).startsWith("1.1.1"))
      .map((r) => cellText(r[5]!));
    expect(caja).toEqual(["$500,00", "$600,00", "$570,00"]);
    // An account with no opening starts at zero.
    const ventas = out.rows
      .filter((r) => cellText(r[0]!).startsWith("4.1.1"))
      .map((r) => cellText(r[5]!));
    expect(ventas).toEqual(["$0,00", "$-100,00"]);
  });

  it("balance de sumas y saldos splits debtor and creditor balances", async () => {
    balancesByPeriod["2026-10"] = [
      {
        account_code: "1.1.1",
        account_name: "Caja",
        account_type: "activo",
        total_debit: 600,
        total_credit: 30,
        balance: 570,
      },
      {
        account_code: "4.1.1",
        account_name: "Ventas",
        account_type: "resultado_positivo",
        total_debit: 0,
        total_credit: 570,
        balance: -570,
      },
    ];
    const out = await balanceSumasSaldos.load(params("2026-10"), range);
    expect(out.rows.map((r) => r.slice(5).map(cellText))).toEqual([
      ["$570,00", ""],
      ["", "$570,00"],
    ]);
    expect(out.totalsRow?.slice(3).map(cellText)).toEqual([
      "$600,00",
      "$600,00",
      "$570,00",
      "$570,00",
    ]);
  });
});
