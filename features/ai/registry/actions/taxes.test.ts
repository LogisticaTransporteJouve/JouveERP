import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/taxes/actions/tax-documents-actions", () => ({
  listTaxDocumentsAction: vi.fn(),
  getIvaPositionEstimateAction: vi.fn(),
}));
vi.mock("@/lib/format", async (orig) => ({
  ...(await orig<typeof import("@/lib/format")>()),
  todayInAR: () => "2026-11-10",
}));

import {
  getIvaPositionEstimateAction,
  listTaxDocumentsAction,
} from "@/features/taxes/actions/tax-documents-actions";
import type { TaxDocument } from "@/features/taxes/schema";

import { classifyTaxDocuments, runTaxDocuments } from "./taxes";

function doc(overrides: Partial<TaxDocument>): TaxDocument {
  return {
    id: "d1",
    kind: "iva",
    title: null,
    jurisdiction: null,
    period: "2026-10",
    due_date: "2026-11-18",
    amount: 1000,
    amount_is_estimate: false,
    status: "liquidado",
    account_id: null,
    account_name: null,
    payment_transaction_id: null,
    payment_origin: null,
    paid_date: null,
    paid_amount: null,
    paid_from: null,
    credit_balance: null,
    notes: null,
    ...overrides,
  };
}

const DOCS = [
  doc({
    id: "overdue",
    due_date: "2026-11-05",
    kind: "iibb",
    jurisdiction: "Buenos Aires",
  }),
  doc({
    id: "soon",
    due_date: "2026-11-18",
    amount: null,
    status: "pendiente",
  }),
  doc({ id: "estimate", due_date: "2026-12-20", amount_is_estimate: true }),
  doc({
    id: "paid",
    kind: "sicore",
    status: "pagado",
    paid_date: "2026-11-09",
    paid_amount: 300,
    payment_origin: "pay",
  }),
  doc({
    id: "paid-before",
    status: "pagado",
    paid_date: "2026-10-20",
    paid_amount: 50,
  }),
  doc({ id: "annulled", due_date: "2026-11-01", status: "anulado" }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classifyTaxDocuments", () => {
  it("splits overdue, due soon, paid in the month and open estimates", () => {
    const g = classifyTaxDocuments(DOCS, {
      today: "2026-11-10",
      withinDays: 15,
      period: "2026-11",
    });
    expect(g.overdue.map((r) => r.id)).toEqual(["overdue"]);
    expect(g.overdue[0]?.label).toBe("IIBB (Buenos Aires)");
    expect(g.due_soon.map((r) => r.id)).toEqual(["soon"]);
    expect(g.paid_in_period.map((r) => r.id)).toEqual(["paid"]);
    expect(g.open_estimates.map((r) => r.id)).toEqual(["estimate"]);
  });

  it("an annulled document counts nowhere", () => {
    const g = classifyTaxDocuments([DOCS[5]!], {
      today: "2026-11-10",
      withinDays: 90,
      period: "2026-11",
    });
    expect(Object.values(g).every((rows) => rows.length === 0)).toBe(true);
  });
});

describe("runTaxDocuments", () => {
  it("reads this year and the period's (deduplicated) and sums each group", async () => {
    vi.mocked(listTaxDocumentsAction).mockResolvedValue({
      ok: true,
      data: DOCS,
    });
    const res = await runTaxDocuments({});
    // Today 2026-11, period 2026-11, the month before 2026-10: one year.
    expect(listTaxDocumentsAction).toHaveBeenCalledTimes(1);
    expect(listTaxDocumentsAction).toHaveBeenCalledWith({ year: 2026 });
    expect(getIvaPositionEstimateAction).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toContain("1 overdue ($1.000)");
    expect(res.summary).toContain("1 paid in 2026-11 ($300)");
    expect(res.summary).toContain("1 due without amount yet");
    expect(res.partial).toBe(false);
  });

  it("a January period also reads the year before", async () => {
    vi.mocked(listTaxDocumentsAction).mockResolvedValue({ ok: true, data: [] });
    await runTaxDocuments({ period: "2027-01" });
    expect(vi.mocked(listTaxDocumentsAction).mock.calls).toEqual([
      [{ year: 2026 }],
      [{ year: 2027 }],
    ]);
  });

  it("adds the IVA estimate when asked, and says so when it is refused", async () => {
    vi.mocked(listTaxDocumentsAction).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(getIvaPositionEstimateAction).mockResolvedValue({
      ok: false,
      error: "No tenés permiso para cargar impuestos.",
    });
    const res = await runTaxDocuments({ ivaPeriod: "2026-10" });
    expect(getIvaPositionEstimateAction).toHaveBeenCalledWith({
      period: "2026-10",
    });
    expect(res.ok && res.partial).toBe(true);
    expect(res.ok && res.note).toContain("No tenés permiso");
  });

  it("returns the list's error", async () => {
    vi.mocked(listTaxDocumentsAction).mockResolvedValue({
      ok: false,
      error: "No tenés permiso para ver impuestos.",
    });
    expect((await runTaxDocuments({})).ok).toBe(false);
  });
});
