import { describe, expect, it, vi } from "vitest";

import { createWithClaim } from "./claim";

function setup(won = true) {
  const release = vi.fn(async () => {});
  return {
    claim: vi.fn(async () => won),
    release,
    alreadyProcessed: "Ya procesado.",
  };
}

describe("createWithClaim", () => {
  it("does not create when another caller holds the claim", async () => {
    const opts = setup(false);
    const create = vi.fn();
    expect(await createWithClaim({ ...opts, create })).toEqual({
      ok: false,
      error: "Ya procesado.",
    });
    expect(create).not.toHaveBeenCalled();
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
