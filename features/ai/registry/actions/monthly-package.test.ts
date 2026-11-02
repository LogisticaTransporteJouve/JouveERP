import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

vi.mock("@/features/monthly-package/actions/monthly-package-actions", () => ({
  getMonthlyPackageStatusAction: vi.fn(),
}));

import { getMonthlyPackageStatusAction } from "@/features/monthly-package/actions/monthly-package-actions";

import {
  getMonthlyPackageStatus,
  runMonthlyPackageStatus,
} from "./monthly-package";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runMonthlyPackageStatus", () => {
  it("counts the checks needing attention and flags unread ones as partial", async () => {
    vi.mocked(getMonthlyPackageStatusAction).mockResolvedValue({
      ok: true,
      data: {
        period: "2026-10",
        closedAt: null,
        closedReadFailed: false,
        pendingJournal: 2,
        missingJournal: null,
        invoicesDraft: 0,
        invoicesEmitting: 0,
        invoicesFailed: 1,
        caeaUninformed: 0,
        purchasesWithoutLetter: 0,
      },
    });
    const res = await runMonthlyPackageStatus({ period: "2026-10" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toBe(
      "2026-10: open; 2 checks need attention, 1 could not be read.",
    );
    expect(res.partial).toBe(true);
  });
});

describe("getMonthlyPackageStatus gate", () => {
  it("needs accounting:read, like the page", async () => {
    expect(getMonthlyPackageStatus.permissions).toEqual(["accounting:read"]);
    const res = await getMonthlyPackageStatus.execute(
      { userId: "u1", access: resolveAccess(["operations"]) },
      { period: "2026-10" },
    );
    expect(res.ok).toBe(false);
    expect(getMonthlyPackageStatusAction).not.toHaveBeenCalled();
  });
});
