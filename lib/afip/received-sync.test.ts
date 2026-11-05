import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const status = vi.fn();
const password = vi.fn();
const ingest = vi.fn();
vi.mock("./arca-web-account", () => ({
  getArcaWebAccountStatus: () => status(),
  readArcaWebPassword: () => password(),
}));
vi.mock("./received-vouchers", () => ({
  ingestReceivedVouchers: (...args: unknown[]) => ingest(...args),
}));

const { runReceivedSync, monthRanges } = await import("./received-sync");
const { ArcaRobotError } = await import("./mis-comprobantes/robot");

const rpc = vi.fn(async () => ({ error: null }));
const marks: Record<string, unknown>[] = [];
const supabase = {
  rpc,
  from: () => ({
    update: (fields: Record<string, unknown>) => ({
      eq: async () => {
        marks.push(fields);
        return { error: null };
      },
    }),
  }),
} as never;
const COMPANY = "30711111118";
const voucher = { kind: "factura" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  marks.length = 0;
  status.mockResolvedValue({
    state: "ok",
    cuit: "20111111112",
    version: "2026-11-04T08:00:00Z",
  });
  password.mockResolvedValue("clave");
  ingest.mockResolvedValue({
    inserted: 1,
    unsupported: 0,
    alreadyInTray: 2,
    linked: 0,
  });
});

describe("monthRanges", () => {
  it("splits a range by calendar month, clipped to its bounds", () => {
    expect(monthRanges("2026-09-15", "2026-11-04")).toEqual([
      ["2026-09-15", "2026-09-30"],
      ["2026-10-01", "2026-10-31"],
      ["2026-11-01", "2026-11-04"],
    ]);
    expect(monthRanges("2026-12-20", "2027-01-10")).toEqual([
      ["2026-12-20", "2026-12-31"],
      ["2027-01-01", "2027-01-10"],
    ]);
    expect(monthRanges("2028-02-01", "2028-02-29")).toEqual([
      ["2028-02-01", "2028-02-29"],
    ]);
  });
});

describe("runReceivedSync", () => {
  it("signs in once, reads each month and adds it to the tray", async () => {
    const queryReceived = vi.fn(async () => ({
      vouchers: [voucher],
      skippedByReason: { bad_cuit: 1 },
      skipped: [
        { reason: "bad_cuit" as const, ref: "tipo 1 · 00003-00000007" },
      ],
    }));
    const signIn = vi.fn(async () => ({ queryReceived }));
    const out = await runReceivedSync(
      supabase,
      { from: "2026-10-15", to: "2026-11-04" },
      { representedCuit: COMPANY, signIn },
    );
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith({
      cuit: "20111111112",
      password: "clave",
      representedCuit: COMPANY,
    });
    expect(queryReceived.mock.calls).toEqual([
      ["2026-10-15", "2026-10-31"],
      ["2026-11-01", "2026-11-04"],
    ]);
    expect(ingest).toHaveBeenCalledWith(supabase, [voucher], {
      origin: "sync",
    });
    expect(rpc).toHaveBeenCalledWith("record_arca_web_attempt", {
      p_ok: true,
      p_error_code: "",
      p_version: "2026-11-04T08:00:00Z",
    });
    expect(out).toEqual({
      outcome: "done",
      counts: { inserted: 2, unsupported: 0, alreadyInTray: 4, linked: 0 },
      skippedRows: 2,
      skipped: [
        {
          month: "2026-10",
          reason: "bad_cuit",
          ref: "tipo 1 · 00003-00000007",
        },
        {
          month: "2026-11",
          reason: "bad_cuit",
          ref: "tipo 1 · 00003-00000007",
        },
      ],
      failedMonths: {},
    });
    // The tray follows the run: started, then finished with this result.
    expect(marks).toEqual([
      { sync_started_at: expect.any(String) },
      { sync_finished_at: expect.any(String), sync_result: out },
    ]);
  });

  it("does not sign in when the clave is missing or was rejected", async () => {
    const signIn = vi.fn();
    status.mockResolvedValueOnce({ state: "missing", cuit: null });
    expect(
      await runReceivedSync(
        supabase,
        { from: "2026-11-01", to: "2026-11-04" },
        {
          representedCuit: COMPANY,
          signIn,
        },
      ),
    ).toEqual({ outcome: "skipped", reason: "not_configured" });
    status.mockResolvedValueOnce({
      state: "rejected",
      cuit: "20111111112",
      version: "v",
    });
    expect(
      await runReceivedSync(
        supabase,
        { from: "2026-11-01", to: "2026-11-04" },
        {
          representedCuit: COMPANY,
          signIn,
        },
      ),
    ).toEqual({ outcome: "skipped", reason: "rejected" });
    expect(signIn).not.toHaveBeenCalled();
    expect(password).not.toHaveBeenCalled();
  });

  it("records a rejected clave so the next runs stop", async () => {
    const signIn = vi.fn(async () => {
      throw new ArcaRobotError("SIGN_IN_REJECTED", "x");
    });
    const out = await runReceivedSync(
      supabase,
      { from: "2026-11-01", to: "2026-11-04" },
      { representedCuit: COMPANY, signIn },
    );
    expect(out).toEqual({
      outcome: "sign_in_failed",
      code: "SIGN_IN_REJECTED",
    });
    expect(rpc).toHaveBeenCalledWith("record_arca_web_attempt", {
      p_ok: false,
      p_error_code: "SIGN_IN_REJECTED",
      p_version: "2026-11-04T08:00:00Z",
    });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("keeps reading after a month with too many results, stops on a lost connection", async () => {
    const queryReceived = vi
      .fn()
      .mockRejectedValueOnce(new ArcaRobotError("TOO_MANY", "x"))
      .mockResolvedValueOnce({
        vouchers: [voucher],
        skippedByReason: {},
        skipped: [],
      })
      .mockRejectedValueOnce(new ArcaRobotError("NETWORK", "x"));
    const out = await runReceivedSync(
      supabase,
      { from: "2026-08-01", to: "2026-11-30" },
      { representedCuit: COMPANY, signIn: async () => ({ queryReceived }) },
    );
    expect(queryReceived).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({
      outcome: "done",
      counts: { inserted: 1 },
      failedMonths: {
        "2026-08": "TOO_MANY",
        "2026-10": "NETWORK",
        "2026-11": "NOT_READ",
      },
    });
  });

  it("fails loudly when a failed sign-in cannot be recorded", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "XX000" } } as never);
    await expect(
      runReceivedSync(
        supabase,
        { from: "2026-11-01", to: "2026-11-04" },
        {
          representedCuit: COMPANY,
          signIn: async () => {
            throw new ArcaRobotError("SIGN_IN_FAILED", "x", "clave");
          },
        },
      ),
    ).rejects.toThrow();
    expect(marks.at(-1)).toEqual({
      sync_finished_at: expect.any(String),
      sync_result: { outcome: "sign_in_failed", code: "RECORD_FAILED" },
    });
  });

  it("reports the months left past the time budget", async () => {
    let t = 0;
    const queryReceived = vi.fn(async () => {
      t += 150_000;
      return { vouchers: [], skippedByReason: {}, skipped: [] };
    });
    const out = await runReceivedSync(
      supabase,
      { from: "2026-08-01", to: "2026-11-30" },
      {
        representedCuit: COMPANY,
        signIn: async () => ({ queryReceived }),
        now: () => t,
      },
    );
    expect(queryReceived).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({
      outcome: "done",
      failedMonths: { "2026-10": "TIME_BUDGET", "2026-11": "TIME_BUDGET" },
    });
  });

  it("does not count a failure before the clave was sent toward the stop", async () => {
    const out = await runReceivedSync(
      supabase,
      { from: "2026-11-01", to: "2026-11-04" },
      {
        representedCuit: COMPANY,
        signIn: async () => {
          throw new ArcaRobotError("SIGN_IN_FAILED", "captcha");
        },
      },
    );
    expect(out).toEqual({ outcome: "sign_in_failed", code: "SIGN_IN_FAILED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("counts the time budget from the start of the run, sign-in included", async () => {
    let t = 0;
    const queryReceived = vi.fn(async () => ({
      vouchers: [],
      skippedByReason: {},
      skipped: [],
    }));
    const out = await runReceivedSync(
      supabase,
      { from: "2026-10-01", to: "2026-11-30" },
      {
        representedCuit: COMPANY,
        signIn: async () => {
          t += 210_000;
          return { queryReceived };
        },
        now: () => t,
      },
    );
    expect(queryReceived).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      failedMonths: { "2026-10": "TIME_BUDGET", "2026-11": "TIME_BUDGET" },
    });
  });

  it("stamps the end of a run that throws anything", async () => {
    ingest.mockRejectedValueOnce(new Error("boom"));
    await expect(
      runReceivedSync(
        supabase,
        { from: "2026-11-01", to: "2026-11-04" },
        {
          representedCuit: COMPANY,
          signIn: async () => ({
            queryReceived: async () => ({
              vouchers: [voucher],
              skippedByReason: {},
              skipped: [],
            }),
          }),
        },
      ),
    ).rejects.toThrow("boom");
    expect(marks.at(-1)).toEqual({
      sync_finished_at: expect.any(String),
      sync_result: { outcome: "failed", code: "UNEXPECTED" },
    });
  });

  it("tells a failed read apart from a missing user", async () => {
    status.mockResolvedValueOnce(null);
    expect(
      await runReceivedSync(
        supabase,
        { from: "2026-11-01", to: "2026-11-04" },
        { representedCuit: COMPANY, signIn: vi.fn() },
      ),
    ).toEqual({ outcome: "skipped", reason: "read_failed" });
    password.mockResolvedValueOnce(null);
    expect(
      await runReceivedSync(
        supabase,
        { from: "2026-11-01", to: "2026-11-04" },
        { representedCuit: COMPANY, signIn: vi.fn() },
      ),
    ).toEqual({ outcome: "skipped", reason: "read_failed" });
  });

  it("reads the newer months after one ARCA answered badly", async () => {
    const queryReceived = vi
      .fn()
      .mockRejectedValueOnce(new ArcaRobotError("QUERY_FAILED", "x"))
      .mockResolvedValueOnce({
        vouchers: [voucher],
        skippedByReason: {},
        skipped: [],
      });
    const out = await runReceivedSync(
      supabase,
      { from: "2026-10-01", to: "2026-11-30" },
      { representedCuit: COMPANY, signIn: async () => ({ queryReceived }) },
    );
    expect(queryReceived).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({
      counts: { inserted: 1 },
      failedMonths: { "2026-10": "QUERY_FAILED" },
    });
  });

  it("takes a failure after ARCA accepted the clave as proof the clave works", async () => {
    const out = await runReceivedSync(
      supabase,
      { from: "2026-11-01", to: "2026-11-04" },
      {
        representedCuit: COMPANY,
        signIn: async () => {
          throw new ArcaRobotError("SIGN_IN_FAILED", "portal", "after_clave");
        },
      },
    );
    expect(out).toEqual({ outcome: "sign_in_failed", code: "SIGN_IN_FAILED" });
    expect(rpc).toHaveBeenCalledWith("record_arca_web_attempt", {
      p_ok: true,
      p_error_code: "",
      p_version: "2026-11-04T08:00:00Z",
    });
  });
});
