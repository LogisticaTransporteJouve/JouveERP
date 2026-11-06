import { beforeEach, describe, expect, it, vi } from "vitest";

import { isRole, resolveAccess } from "@/lib/auth/permissions";

const USER = "00000000-0000-4000-8000-000000000001";
const RUN = "00000000-0000-4000-8000-0000000000aa";

let roles: string[] = ["owner"];
let insertError: { code: string } | null = null;
let sendFails = false;
const sent: unknown[] = [];
const inserted: unknown[] = [];
const failed: string[] = [];
const audit = vi.fn();

const service = {
  from: () => ({
    insert: (row: unknown) => {
      inserted.push(row);
      return {
        select: () => ({
          single: async () =>
            insertError
              ? { data: null, error: insertError }
              : { data: { id: RUN }, error: null },
        }),
      };
    },
  }),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: USER,
    access: resolveAccess(roles.filter(isRole)),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: () => service }));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => audit(...args),
}));
vi.mock("@/lib/purchases/arca-bulk-accept", () => ({
  closeStaleBulkRuns: async () => {},
  failBulkRun: async (_s: unknown, id: string) => void failed.push(id),
  readLatestBulkRun: async () => null,
}));
vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    send: async (e: unknown) => {
      if (sendFails) throw new Error("down");
      sent.push(e);
    },
  },
}));

const { requestArcaBulkAcceptAction, getArcaBulkAcceptStatusAction } =
  await import("./arca-bulk-accept-actions");

beforeEach(() => {
  roles = ["owner"];
  insertError = null;
  sendFails = false;
  sent.length = 0;
  inserted.length = 0;
  failed.length = 0;
  audit.mockClear();
});

describe("requestArcaBulkAcceptAction", () => {
  it("opens a run and queues it for the owner", async () => {
    const res = await requestArcaBulkAcceptAction({ confirm: true });
    expect(res).toEqual({ ok: true, data: { runId: RUN } });
    expect(inserted).toEqual([{ requested_by: USER }]);
    expect(sent).toEqual([
      {
        id: `arca-bulk-accept-${RUN}`,
        name: "afip/received-bulk-accept.requested",
        data: { run_id: RUN, requested_by: USER },
      },
    ]);
    expect(audit).toHaveBeenCalledWith(
      "purchase_invoice.arca_bulk_accept_requested",
      USER,
      { runId: RUN, openingDate: "2026-10-31" },
      RUN,
    );
  });

  it.each([["admin"], ["finance"]])("refuses %s", async (role) => {
    roles = [role];
    const res = await requestArcaBulkAcceptAction({ confirm: true });
    expect(res.ok).toBe(false);
    expect(inserted).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("needs the confirmation", async () => {
    const res = await requestArcaBulkAcceptAction({});
    expect(res.ok).toBe(false);
    expect(inserted).toEqual([]);
  });

  it("refuses a second run while one is open", async () => {
    insertError = { code: "23505" };
    const res = await requestArcaBulkAcceptAction({ confirm: true });
    expect(res).toEqual({
      ok: false,
      error: "Ya hay una carga de todos los pendientes en curso.",
    });
    expect(sent).toEqual([]);
  });

  it("closes the run when the event cannot be sent", async () => {
    sendFails = true;
    const res = await requestArcaBulkAcceptAction({ confirm: true });
    expect(res.ok).toBe(false);
    expect(failed).toEqual([RUN]);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("getArcaBulkAcceptStatusAction", () => {
  it("is for the owner only", async () => {
    expect(await getArcaBulkAcceptStatusAction()).toEqual({
      ok: true,
      data: null,
    });
    roles = ["admin"];
    expect((await getArcaBulkAcceptStatusAction()).ok).toBe(false);
  });
});
