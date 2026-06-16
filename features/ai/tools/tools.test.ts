import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/aging/actions/aging-actions", () => ({
  getAgingSummaryAction: vi.fn(),
}));
vi.mock("@/features/balance/actions/balance-actions", () => ({
  getAccountBalancesAction: vi.fn(),
}));
vi.mock("@/features/libro-mayor/actions/libro-mayor-actions", () => ({
  getLedgerAction: vi.fn(),
}));
vi.mock("@/features/libro-iva/actions/libro-iva-actions", () => ({
  listLibroIvaVentasAction: vi.fn(),
  listLibroIvaComprasAction: vi.fn(),
}));
vi.mock("@/features/treasury/actions/treasury-actions", () => ({
  getTreasurySummaryAction: vi.fn(),
}));

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import { getAccountBalancesAction } from "@/features/balance/actions/balance-actions";
import { getLedgerAction } from "@/features/libro-mayor/actions/libro-mayor-actions";
import { listLibroIvaVentasAction } from "@/features/libro-iva/actions/libro-iva-actions";

import { runLedger, runLibroIvaVentas, runTrialBalance } from "./accounting";
import { runClientAging } from "./receivables";
import { AI_TOOL_NAMES, aiTools } from "./registry";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ai tools registry", () => {
  it("exposes 6 uniquely-named tools, each with a non-trivial description", () => {
    expect(AI_TOOL_NAMES).toHaveLength(6);
    expect(new Set(AI_TOOL_NAMES).size).toBe(6);
    for (const name of AI_TOOL_NAMES) {
      const desc = aiTools[name].description;
      expect(typeof desc).toBe("string");
      expect((desc ?? "").length).toBeGreaterThan(10);
    }
  });
});

describe("runClientAging", () => {
  it("summarizes the aging totals on success", async () => {
    vi.mocked(getAgingSummaryAction).mockResolvedValue({
      ok: true,
      data: {
        clients: [],
        totals: {
          bucket_0_30: 100,
          bucket_30_60: 0,
          bucket_60_90: 0,
          bucket_90_plus: 200,
          total_open: 1000,
          client_count: 3,
          document_count: 5,
        },
      },
    });
    const r = await runClientAging();
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("3 clientes");
    expect(r.summary).toContain("+90");
  });

  it("returns an error result (never throws) when the action denies", async () => {
    vi.mocked(getAgingSummaryAction).mockResolvedValue({
      ok: false,
      error: "No tenés permiso para ver aging.",
    });
    const r = await runClientAging();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("No tenés permiso para ver aging.");
  });
});

describe("runTrialBalance", () => {
  it("forwards periodEnd (periodStart defaults to null) and reports the count", async () => {
    vi.mocked(getAccountBalancesAction).mockResolvedValue({ ok: true, data: [] });
    const r = await runTrialBalance({ periodEnd: "2026-05" });
    expect(getAccountBalancesAction).toHaveBeenCalledWith({
      periodEnd: "2026-05",
      periodStart: null,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("2026-05");
  });
});

describe("runLedger", () => {
  it("flags truncation in the summary", async () => {
    vi.mocked(getLedgerAction).mockResolvedValue({
      ok: true,
      data: { rows: [], truncated: true },
    });
    const r = await runLedger({ accountId: "acc-1" });
    expect(getLedgerAction).toHaveBeenCalledWith({
      accountId: "acc-1",
      from: null,
      to: null,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("truncado");
  });
});

describe("runLibroIvaVentas", () => {
  it("reports the row count for the period", async () => {
    vi.mocked(listLibroIvaVentasAction).mockResolvedValue({ ok: true, data: [] });
    const r = await runLibroIvaVentas({ period: "2026-05" });
    expect(listLibroIvaVentasAction).toHaveBeenCalledWith({
      period: "2026-05",
      channelId: null,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("IVA Ventas");
  });
});
