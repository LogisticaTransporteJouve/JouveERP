import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const buildData = vi.fn();
const logError = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/pdf/libro-iva-ventas-render", () => ({
  buildLibroIvaVentasTemplateData: buildData,
  renderLibroIvaVentasPdf: vi.fn(),
}));

const { GET } = await import("./route");

beforeEach(() => {
  buildData.mockReset();
  logError.mockReset();
});

describe("GET /api/accounting/libro-iva-ventas/pdf", () => {
  it("a read failure logs the error and keeps the database text out of the response", async () => {
    const failure = new Error(
      'Could not read libro IVA Ventas: relation "public.v_libro_iva_ventas" does not exist',
    );
    buildData.mockRejectedValue(failure);
    const res = await GET(
      new Request(
        "http://localhost/api/accounting/libro-iva-ventas/pdf?period=2026-06",
      ),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error generando PDF." });
    expect(logError).toHaveBeenCalledWith("libro_iva.ventas.pdf.failed", {
      period: "2026-06",
      error: failure,
    });
  });
});
