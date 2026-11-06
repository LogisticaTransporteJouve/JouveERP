import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getStrixAccountStatus = vi.fn();
const readStrixPassword = vi.fn();
vi.mock("./strix-account", () => ({
  getStrixAccountStatus,
  readStrixPassword,
}));

const { runStrixKmSync } = await import("./km-sync");

type Client = Parameters<typeof runStrixKmSync>[0];
// A partial Supabase client: only what the sync calls.
const client = (db: object): Client => db as unknown as Client;
const { StrixError } = await import("./robot");

const ACTIVE = {
  state: "ok",
  username: "u@x.com",
  version: "2026-11-06T00:00:00Z",
  lastSuccessAt: null,
  lastErrorCode: null,
  sync: {},
};

function fakeDb() {
  const upserts: unknown[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const updates: unknown[] = [];
  const db = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
      rpcs.push({ fn, args });
      return { data: true, error: null };
    }),
    from: vi.fn((table: string) => ({
      update: (fields: unknown) => ({
        eq: async () => {
          updates.push({ table, fields });
          return { error: null };
        },
      }),
      upsert: async (rows: unknown) => {
        upserts.push(rows);
        return { error: null };
      },
      select: () => ({
        order: () => ({
          range: async (from: number) => ({
            data:
              from === 0
                ? [
                    { id: "v1", patente: "AA 111 AA" },
                    { id: "v2", patente: "BB222BB" },
                  ]
                : [],
            error: null,
          }),
        }),
      }),
    })),
  };
  return { db, upserts, rpcs, updates };
}

describe("runStrixKmSync", () => {
  it("saves each matched vehicle's km per day and names the rest", async () => {
    getStrixAccountStatus.mockResolvedValue(ACTIVE);
    readStrixPassword.mockResolvedValue("pw");
    const kmDriven = vi.fn(async (from: string) =>
      from === "2026-10-30"
        ? [
            { domain: "AA111AA", day: "2026-10-30", km: 100.04 },
            { domain: "ZZ999ZZ", day: "2026-10-31", km: 5 },
          ]
        : [{ domain: "BB222BB", day: "2026-11-01", km: 7 }],
    );
    const signIn = vi.fn(async () => ({
      vehicles: async () => [{ thing_id: "t", domain: "AA111AA", label: "" }],
      kmDriven,
    }));
    const { db, upserts, rpcs } = fakeDb();

    const res = await runStrixKmSync(
      client(db),
      { from: "2026-10-30", to: "2026-11-02" },
      {
        signIn,
      },
    );

    expect(kmDriven).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({
      outcome: "done",
      days: 2,
      vehicles: 2,
      unmatched: ["ZZ999ZZ"],
      failedMonths: {},
    });
    expect(upserts[0]).toEqual([
      expect.objectContaining({ vehicle_id: "v1", day: "2026-10-30", km: 100 }),
    ]);
    expect(rpcs[0]).toMatchObject({
      fn: "record_strix_attempt",
      args: { p_ok: true },
    });
  });

  it("records a refused password and stops", async () => {
    getStrixAccountStatus.mockResolvedValue(ACTIVE);
    readStrixPassword.mockResolvedValue("pw");
    const signIn = vi.fn(async () => {
      throw new StrixError("SIGN_IN_REJECTED", "no");
    });
    const { db, rpcs } = fakeDb();
    const res = await runStrixKmSync(
      client(db),
      { from: "2026-11-01", to: "2026-11-02" },
      {
        signIn,
      },
    );
    expect(res).toEqual({
      outcome: "sign_in_failed",
      code: "SIGN_IN_REJECTED",
    });
    expect(rpcs[0]).toMatchObject({
      args: { p_ok: false, p_error_code: "SIGN_IN_REJECTED" },
    });
  });

  it("does not sign in without a configured user", async () => {
    getStrixAccountStatus.mockResolvedValue({ ...ACTIVE, state: "missing" });
    const signIn = vi.fn();
    const { db } = fakeDb();
    const res = await runStrixKmSync(
      client(db),
      { from: "2026-11-01", to: "2026-11-02" },
      {
        signIn,
      },
    );
    expect(res).toEqual({ outcome: "skipped", reason: "not_configured" });
    expect(signIn).not.toHaveBeenCalled();
  });
});
