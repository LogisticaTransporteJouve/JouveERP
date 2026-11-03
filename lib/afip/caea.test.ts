import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as { message: string } | null },
  requestCAEA: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      lte: () => builder,
      gte: () => builder,
      maybeSingle: async () => h.result,
    };
    return { from: () => builder };
  },
}));
vi.mock("./wsfev1", () => ({
  requestCAEA: h.requestCAEA,
  consultCAEA: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { ensureCaea, getActiveCaeaForDate } = await import("./caea");

beforeEach(() => {
  h.result = { data: null, error: null };
  h.requestCAEA.mockReset();
});

describe("getActiveCaeaForDate", () => {
  it("returns null only when no CAEA covers the date", async () => {
    await expect(getActiveCaeaForDate("2026-10-14")).resolves.toBeNull();
  });

  it("throws on a failed read instead of reporting no CAEA", async () => {
    h.result = { data: null, error: { message: "timeout" } };
    await expect(getActiveCaeaForDate("2026-10-14")).rejects.toThrow(
      "load-active-caea: timeout",
    );
  });
});

describe("ensureCaea", () => {
  it("does not ask AFIP for a CAEA when the local read fails", async () => {
    h.result = { data: null, error: { message: "timeout" } };
    await expect(ensureCaea({ periodo: 202610, orden: 2 })).rejects.toThrow(
      "No se pudo leer el CAEA guardado",
    );
    expect(h.requestCAEA).not.toHaveBeenCalled();
  });
});
