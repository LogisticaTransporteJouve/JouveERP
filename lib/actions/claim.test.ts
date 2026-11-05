import { describe, expect, it, vi } from "vitest";

import { type ClaimOutcome, createWithClaim } from "./claim";

function setup(outcome: ClaimOutcome = "won") {
  const release = vi.fn(async () => {});
  return {
    claim: vi.fn(async () => outcome),
    release,
    alreadyProcessed: "Ya procesado.",
    claimFailed: "No se pudo tomar.",
  };
}

describe("createWithClaim", () => {
  it("does not create when another caller holds the claim", async () => {
    const opts = setup("lost");
    const create = vi.fn();
    expect(await createWithClaim({ ...opts, create })).toEqual({
      ok: false,
      error: "Ya procesado.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("a claim that failed to write is not «already processed»", async () => {
    const opts = setup("failed");
    const create = vi.fn();
    expect(await createWithClaim({ ...opts, create })).toEqual({
      ok: false,
      error: "No se pudo tomar.",
    });
    expect(create).not.toHaveBeenCalled();
    expect(opts.release).not.toHaveBeenCalled();
  });

  it("keeps the claim on success", async () => {
    const opts = setup();
    const res = await createWithClaim({
      ...opts,
      create: async () => ({ ok: true, data: 1 }),
    });
    expect(res).toEqual({ ok: true, data: 1 });
    expect(opts.release).not.toHaveBeenCalled();
  });

  it("releases on a failure that created nothing, and on a throw", async () => {
    const opts = setup();
    await createWithClaim({
      ...opts,
      create: async () => ({ ok: false, error: "x" }),
    });
    await expect(
      createWithClaim({
        ...opts,
        create: async () => Promise.reject(new Error("boom")),
      }),
    ).rejects.toThrow("boom");
    expect(opts.release).toHaveBeenCalledTimes(2);
  });

  it("keeps the claim when the row was created and a later step failed", async () => {
    const opts = setup();
    await createWithClaim({
      ...opts,
      create: async () => ({ ok: false, error: "items", createdId: "pi-1" }),
    });
    expect(opts.release).not.toHaveBeenCalled();
  });
});
