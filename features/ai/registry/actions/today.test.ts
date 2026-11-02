import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

vi.mock("@/features/dashboard/actions/dashboard-actions", () => ({
  getDashboardTodayAction: vi.fn(),
}));

import { getDashboardTodayAction } from "@/features/dashboard/actions/dashboard-actions";

import { getTodayOverview, runTodayOverview } from "./today";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTodayOverview", () => {
  it("summarizes the tiles it can read and flags a failed one as partial", async () => {
    vi.mocked(getDashboardTodayAction).mockResolvedValue({
      ok: true,
      data: {
        trips: { ok: false, error: "No se pudo leer." },
        papers: {
          ok: true,
          data: [
            {
              id: "p1",
              holder_kind: "vehicle",
              holder: "AB123CD",
              kind: "VTV",
              expires_at: "2026-10-01",
              expired: true,
              href: "/fleet-documents",
            },
          ],
        },
      },
    });
    const res = await runTodayOverview();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toBe(
      "trips unreadable; 1 papers expired, 0 expiring in 30 days.",
    );
    expect(res.partial).toBe(true);
  });
});

describe("getTodayOverview gate", () => {
  it("needs one of the tiles' read permissions", async () => {
    expect(getTodayOverview.anyOfPermissions).toEqual([
      "trips:read",
      "fleet_documents:read",
      "hr:read",
    ]);
    const res = await getTodayOverview.execute(
      { userId: "u1", access: resolveAccess(["warehouse"]) },
      {},
    );
    expect(res.ok).toBe(false);
    expect(getDashboardTodayAction).not.toHaveBeenCalled();
  });
});
