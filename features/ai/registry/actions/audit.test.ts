import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

vi.mock("@/features/audit/actions/audit-actions", () => ({
  listAuditEventsAction: vi.fn(),
}));

import { listAuditEventsAction } from "@/features/audit/actions/audit-actions";

import { getAuditEvents, runAuditEvents } from "./audit";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runAuditEvents", () => {
  it("reads the first page with the given filters and flags more as partial", async () => {
    vi.mocked(listAuditEventsAction).mockResolvedValue({
      ok: true,
      data: {
        rows: [],
        nextCursor: { ts: "2026-11-02T10:00:00+00:00", id: "x" },
      },
    });
    const res = await runAuditEvents({ module: "invoice" });
    expect(listAuditEventsAction).toHaveBeenCalledWith({
      filters: {
        from: null,
        to: null,
        actorId: null,
        eventType: null,
        module: "invoice",
      },
      cursor: null,
    });
    expect(res.ok && res.partial).toBe(true);
  });
});

describe("getAuditEvents gate", () => {
  it("needs audit:read, like Admin › Auditoría", async () => {
    expect(getAuditEvents.permissions).toEqual(["audit:read"]);
    const res = await getAuditEvents.execute(
      { userId: "u1", access: resolveAccess(["finance"]) },
      {},
    );
    expect(res.ok).toBe(false);
    expect(listAuditEventsAction).not.toHaveBeenCalled();
  });
});
