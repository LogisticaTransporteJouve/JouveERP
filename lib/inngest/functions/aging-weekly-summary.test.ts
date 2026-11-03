import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((ctx: unknown) => Promise<unknown>) | null,
  sends: [] as Array<{ payload: unknown; options: unknown }>,
}));

vi.mock("../client", () => ({
  inngest: {
    createFunction: (
      _config: unknown,
      handler: (ctx: unknown) => Promise<unknown>,
    ) => {
      h.handler = handler;
      return {};
    },
  },
}));
vi.mock("@/lib/email/client", () => ({
  getEmailFrom: () => "erp@test",
  getEmailReplyTo: () => undefined,
  isEmailConfigured: () => true,
  getResendClient: () => ({
    emails: {
      send: async (payload: unknown, options: unknown) => {
        h.sends.push({ payload, options });
        return { data: { id: "m1" }, error: null };
      },
    },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

await import("./aging-weekly-summary");

const zero = { ars: 0, usd: 0 };
const summary = {
  totals: {
    party_count: 0,
    document_count: 0,
    total: zero,
    buckets: { "0_30": zero, "30_60": zero, "60_90": zero, "90_plus": zero },
    total_ars_equivalent: null,
  },
  usd_rate: null,
  top: [],
};

// compose-summary is memoized by Inngest: its value is canned here.
const step = {
  run: async (id: string, fn: () => Promise<unknown>) =>
    id === "compose-summary" ? summary : fn(),
};

describe("aging-weekly-summary", () => {
  it("sends the email with a key that is the same on every retry of the run", async () => {
    vi.stubEnv("FINANCE_EMAIL", "finanzas@test");
    await h.handler?.({ event: { id: "evt-1" }, step });
    await h.handler?.({ event: { id: "evt-1" }, step });
    expect(h.sends.map((s) => s.options)).toEqual([
      { idempotencyKey: "aging-weekly-summary/evt-1" },
      { idempotencyKey: "aging-weekly-summary/evt-1" },
    ]);
    vi.unstubAllEnvs();
  });
});
