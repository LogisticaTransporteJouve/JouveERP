import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/lib/auth/permissions";
import { XLSX_MIME } from "@/lib/export/xlsx";

let roles: Role[] = ["finance"];
const buildData = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", roles }),
}));
vi.mock("@/lib/pdf/libro-iva-ventas-render", () => ({
  buildLibroIvaVentasTemplateData: buildData,
}));

const { GET } = await import("./route");

const get = (query: string) =>
  GET(
    new Request(
      `http://localhost/api/accounting/libro-iva-ventas/xlsx?${query}`,
    ),
  );

beforeEach(() => {
  roles = ["finance"];
  buildData.mockReset().mockResolvedValue({
    period: "2026-06",
    channelName: "DZ Fiscal",
    generatedAt: "",
    rows: [],
  });
});

describe("GET /api/accounting/libro-iva-ventas/xlsx", () => {
  it("403s a role without accounting:read", async () => {
    roles = ["warehouse"];
    const res = await get("period=2026-06");
    expect(res.status).toBe(403);
    expect(buildData).not.toHaveBeenCalled();
  });

  it("400s a malformed period", async () => {
    const res = await get("period=2026-13");
    expect(res.status).toBe(400);
    expect(buildData).not.toHaveBeenCalled();
  });

  it("serves the period's book as Excel", async () => {
    const res = await get("period=2026-06&channel=c1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(XLSX_MIME);
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="libro-iva-ventas-2026-06-dz-fiscal.xlsx"',
    );
    expect(buildData).toHaveBeenCalledWith("2026-06", "c1");
  });

  it("hides the database error behind a generic message", async () => {
    buildData.mockRejectedValue(new Error("relation does not exist"));
    const res = await get("period=2026-06");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error generando el Excel." });
  });
});
