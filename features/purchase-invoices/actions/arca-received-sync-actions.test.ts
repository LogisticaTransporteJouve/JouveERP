import { beforeEach, describe, expect, it, vi } from "vitest";

import { isRole, resolveAccess } from "@/lib/auth/permissions";

let roles: string[] = ["finance"];
let account: Record<string, unknown> | null = null;
const sent: unknown[] = [];
const audit = vi.fn();

const stamps: Record<string, unknown>[] = [];
let stampFails = false;
const service = {
  from: () => ({
    select: () => ({
      maybeSingle: async () => ({ data: account, error: null }),
    }),
    update: (fields: Record<string, unknown>) => ({
      eq: async () => {
        stamps.push(fields);
        return { error: stampFails ? { code: "XX000" } : null };
      },
    }),
  }),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    access: resolveAccess(roles.filter(isRole)),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: () => service }));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => audit(...args),
}));
vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: async (e: unknown) => void sent.push(e) },
}));

const { requestArcaReceivedSyncAction, getArcaSyncStatusAction } =
  await import("./arca-received-sync-actions");

const active = {
  cuit: "20111111112",
  status: "active",
  secret_id: "s",
  last_success_at: "2026-11-04T08:00:00Z",
  last_error_code: null,
  sync_requested_at: null,
  sync_started_at: "2026-11-04T08:00:00Z",
  sync_finished_at: "2026-11-04T08:00:03Z",
  sync_result: {
    outcome: "done",
    counts: { inserted: 14, unsupported: 0, alreadyInTray: 0, linked: 0 },
    skippedRows: 0,
    failedMonths: {},
  },
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-04T12:00:00Z"), toFake: ["Date"] });
  roles = ["finance"];
  account = active;
  sent.length = 0;
  stamps.length = 0;
  stampFails = false;
  audit.mockClear();
});

describe("requestArcaReceivedSyncAction", () => {
  it("queues the run for the chosen months, cut at today", async () => {
    const res = await requestArcaReceivedSyncAction({
      fromMonth: "2026-10",
      toMonth: "2026-11",
    });
    expect(res).toEqual({
      ok: true,
      data: { from: "2026-10-01", to: "2026-11-04" },
    });
    expect(sent).toEqual([
      {
        name: "afip/received-sync.requested",
        data: {
          requested_by: "00000000-0000-4000-8000-000000000001",
          from: "2026-10-01",
          to: "2026-11-04",
        },
      },
    ]);
    expect(stamps).toEqual([{ sync_requested_at: "2026-11-04T12:00:00.000Z" }]);
    expect(audit).toHaveBeenCalledWith(
      "purchase_invoice.arca_sync_requested",
      "00000000-0000-4000-8000-000000000001",
      { from: "2026-10-01", to: "2026-11-04" },
    );
  });

  it("refuses a role without purchase_invoices:write", async () => {
    roles = ["fiscal_reader"];
    const res = await requestArcaReceivedSyncAction({
      fromMonth: "2026-11",
      toMonth: "2026-11",
    });
    expect(res.ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it("does not queue a run the tray could not follow", async () => {
    stampFails = true;
    const res = await requestArcaReceivedSyncAction({
      fromMonth: "2026-11",
      toMonth: "2026-11",
    });
    expect(res.ok ? null : res.error).toMatch(/No se pudo pedir/);
    expect(sent).toEqual([]);
  });

  it("does not queue a run when the clave is missing or rejected", async () => {
    account = null;
    const missing = await requestArcaReceivedSyncAction({
      fromMonth: "2026-11",
      toMonth: "2026-11",
    });
    expect(missing.ok ? null : missing.error).toMatch(/Falta cargar/);
    account = { ...active, status: "sign_in_failing" };
    const rejected = await requestArcaReceivedSyncAction({
      fromMonth: "2026-11",
      toMonth: "2026-11",
    });
    expect(rejected.ok ? null : rejected.error).toMatch(/dejó de entrar/);
    expect(sent).toEqual([]);
  });
});

describe("getArcaSyncStatusAction", () => {
  it("returns the state without the CUIT", async () => {
    const res = await getArcaSyncStatusAction();
    expect(res).toEqual({
      ok: true,
      data: {
        state: "ok",
        lastSuccessAt: "2026-11-04T08:00:00Z",
        lastErrorCode: null,
        sync: {
          requestedAt: null,
          startedAt: "2026-11-04T08:00:00Z",
          finishedAt: "2026-11-04T08:00:03Z",
          result: active.sync_result,
        },
      },
    });
  });
});
