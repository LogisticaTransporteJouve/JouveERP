import { beforeEach, describe, expect, it, vi } from "vitest";

let usdRate: { rate: number } | null = null;
const rows = [
  {
    client_id: "c1",
    ars_bucket_90_plus: "1000",
    usd_bucket_90_plus: "10",
    clients: { legal_name: "Acme" },
  },
  {
    client_id: "c2",
    ars_bucket_90_plus: "500",
    usd_bucket_90_plus: "0",
    clients: { legal_name: "Beta" },
  },
];

vi.mock("@/lib/fx", async (orig) => ({
  ...(await orig<typeof import("@/lib/fx")>()),
  fetchLatestUsdRate: async () => usdRate,
}));
vi.mock("@/lib/supabase/service", () => {
  const chain = {
    select: () => chain,
    or: () => chain,
    order: () => chain,
    range: async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }),
  };
  return { getServiceClient: () => ({ from: () => chain }) };
});

const { gatherReceivablesRisk } = await import("./gather");

beforeEach(() => {
  usdRate = null;
});

describe("gatherReceivablesRisk", () => {
  it("says the dollars were left out when there is no rate", async () => {
    const risk = await gatherReceivablesRisk();
    expect(risk.total90Plus).toBe(1500);
    expect(risk.usdOmitted).toBe(true);
  });

  it("counts the dollars at the rate when there is one", async () => {
    usdRate = { rate: 1000 };
    const risk = await gatherReceivablesRisk();
    expect(risk.total90Plus).toBe(11500);
    expect(risk.usdOmitted).toBe(false);
  });
});
