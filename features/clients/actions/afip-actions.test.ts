import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

// verifyCuitAction shows its own Spanish copy for a rate limit, never the
// RateLimitError message (English, with the internal bucket key).

const h = vi.hoisted(() => ({ rateLimit: vi.fn() }));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error {
    constructor(
      message: string,
      public retryAfterSeconds: number,
      public reason: "exceeded" | "unavailable",
    ) {
      super(message);
    }
  }
  return { RateLimitError, enforceRateLimit: h.rateLimit };
});
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => {
    throw new Error("the rate limit must stop the lookup first");
  },
}));
vi.mock("@/lib/afip/padron", () => ({ consultarPadron: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { RateLimitError } = await import("@/lib/rate-limit");
const { verifyCuitAction } = await import("./afip-actions");

const CUIT = "30712345678";

describe("verifyCuitAction rate limit", () => {
  beforeEach(() => {
    h.rateLimit.mockReset();
  });

  it("over the limit: Spanish message plus the seconds to wait", async () => {
    h.rateLimit.mockImplementation(async () => {
      throw new RateLimitError(
        "Rate limit exceeded for padron_lookup. Try again in 120s.",
        120,
        "exceeded",
      );
    });
    await expect(verifyCuitAction({ cuit: CUIT })).resolves.toEqual({
      ok: false,
      error: "Llegaste al límite de 60 consultas al padrón por hora.",
      retryAfterSeconds: 120,
    });
  });

  it("limit not checkable: Spanish message, no wait shown", async () => {
    h.rateLimit.mockImplementation(async () => {
      throw new RateLimitError(
        "Rate limit check failed for padron_lookup.",
        3600,
        "unavailable",
      );
    });
    await expect(verifyCuitAction({ cuit: CUIT })).resolves.toEqual({
      ok: false,
      error:
        "No se pudo verificar el límite de consultas al padrón. Probá de nuevo.",
    });
  });
});
