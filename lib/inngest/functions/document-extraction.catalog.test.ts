import { describe, expect, it, vi } from "vitest";

let leavesError: { message: string } | null = null;

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const result =
        table === "expense_leaf_accounts"
          ? {
              data: leavesError ? null : [{ code: "5.1", name: "Fletes" }],
              error: leavesError,
            }
          : { data: [{ code: "CC1", name: "Logística" }], error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  }),
}));

const { readExpenseCatalog } = await import("./document-extraction");

describe("readExpenseCatalog", () => {
  it("returns the accounts and cost centers", async () => {
    leavesError = null;
    await expect(readExpenseCatalog()).resolves.toEqual({
      leaves: [{ code: "5.1", name: "Fletes" }],
      costCenters: [{ code: "CC1", name: "Logística" }],
    });
  });

  it("throws on a failed read so the step retries, not an empty catalog", async () => {
    leavesError = { message: "timeout" };
    await expect(readExpenseCatalog()).rejects.toThrow("timeout");
  });
});
