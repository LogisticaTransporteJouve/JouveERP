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
  status.mockResolvedValue({ state: "ok", cuit: "20111111112" });
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
    expect(rpc).toHaveBeenCalledWith("record_arca_web_sign_in", {
      p_ok: true,
      p_error_code: "",
    });
    expect(out).toEqual({
      outcome: "done",
      counts: { inserted: 2, unsupported: 0, alreadyInTray: 4, linked: 0 },
      skippedRows: 2,
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
    status.mockResolvedValueOnce({ state: "rejected", cuit: "20111111112" });
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
    expect(rpc).toHaveBeenCalledWith("record_arca_web_sign_in", {
      p_ok: false,
      p_error_code: "SIGN_IN_REJECTED",
    });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("keeps reading after a month with too many results, stops on a broken query", async () => {
    const queryReceived = vi
      .fn()
      .mockRejectedValueOnce(new ArcaRobotError("TOO_MANY", "x"))
      .mockResolvedValueOnce({ vouchers: [voucher], skippedByReason: {} })
      .mockRejectedValueOnce(new ArcaRobotError("QUERY_FAILED", "x"));
    const out = await runReceivedSync(
      supabase,
      { from: "2026-08-01", to: "2026-11-30" },
      { representedCuit: COMPANY, signIn: async () => ({ queryReceived }) },
    );
    expect(queryReceived).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({
      outcome: "done",
      counts: { inserted: 1 },
      failedMonths: { "2026-08": "TOO_MANY", "2026-10": "QUERY_FAILED" },
    });
  });
});
