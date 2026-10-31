import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";
import { XLSX_MIME } from "@/lib/export/xlsx";

let roles: Role[] = ["finance"];
const load = vi.fn();
const renderTableReportPdf = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/pdf/table-report-render", () => ({ renderTableReportPdf }));
const getAgingSummaryAction = vi.fn();
vi.mock("@/features/aging/actions/aging-actions", () => ({
  getAgingSummaryAction,
}));
vi.mock("../exporters", async () => {
  const { aging } = await import("../resources/aging");
  return {
    EXPORTERS: { invoices: { permission: "invoices:read", load }, aging },
  };
});

const { GET } = await import("./route");

function get(query: string, resource = "invoices") {
  return GET(new Request(`http://localhost/api/export/${resource}?${query}`), {
    params: Promise.resolve({ resource }),
  });
}

beforeEach(() => {
  roles = ["finance"];
  load.mockReset().mockResolvedValue({
    title: "Comprobantes",
    columns: [
      { header: "Comprobante", width: 100 },
      { header: "Total", width: 100, align: "right" },
    ],
    rows: [
      [
        "0001-00000042",
        { text: "$10,00", value: { money: 10, currency: "ARS" } },
      ],
    ],
    fileName: "comprobantes",
  });
  renderTableReportPdf.mockReset().mockResolvedValue(Buffer.from("%PDF"));
});

describe("GET /api/export/[resource]", () => {
  it("404s an unknown resource", async () => {
    const res = await get("format=xlsx", "nope");
    expect(res.status).toBe(404);
  });

  it.each(["", "format=xlsx"])(
    "403s a role without the exporter's permission (%s)",
    async (query) => {
      roles = ["warehouse"];
      const res = await get(query);
      expect(res.status).toBe(403);
      expect(load).not.toHaveBeenCalled();
    },
  );

  it("serves the exporter's rows as Excel with format=xlsx", async () => {
    const res = await get("format=xlsx&to=2026-06-30");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(XLSX_MIME);
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="comprobantes-2026-06-30.xlsx"',
    );
    expect(load).toHaveBeenCalledWith(expect.any(URLSearchParams), {
      from: null,
      to: "2026-06-30",
    });
    expect(renderTableReportPdf).not.toHaveBeenCalled();
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A zip archive.
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it("hides a loader's error behind a generic message", async () => {
    load.mockRejectedValue(new Error("Could not load invoices."));
    const res = await get("format=xlsx");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error generando el archivo." });
  });

  it("400s an invalid scope without loading", async () => {
    const res = await get("scope=dz", "aging");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Alcance inválido." });
    expect(getAgingSummaryAction).not.toHaveBeenCalled();
  });

  it.each([
    ["fiscal", true],
    ["internal", false],
    ["all", null],
  ])("passes scope=%s to the aging read", async (scope, isFiscal) => {
    getAgingSummaryAction.mockReset().mockResolvedValue({
      ok: true,
      data: {
        rows: [],
        totals: {
          buckets: {
            "0_30": { ars: 0, usd: 0 },
            "30_60": { ars: 0, usd: 0 },
            "60_90": { ars: 0, usd: 0 },
            "90_plus": { ars: 0, usd: 0 },
          },
          total: { ars: 0, usd: 0 },
          total_ars_equivalent: 0,
          party_count: 0,
          document_count: 0,
        },
        usd_rate: null,
      },
    });
    const res = await get(`scope=${scope}`, "aging");
    expect(res.status).toBe(200);
    expect(getAgingSummaryAction).toHaveBeenCalledWith({ isFiscal });
  });

  it("keeps the PDF as the default, with typed cells as their text", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(renderTableReportPdf).toHaveBeenCalledWith(
      expect.objectContaining({ rows: [["0001-00000042", "$10,00"]] }),
    );
  });
});
