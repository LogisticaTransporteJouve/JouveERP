// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import type { ChartAccount } from "../schema";

const account: ChartAccount = {
  id: "a1",
  code: "1",
  name: "Caja y bancos",
  account_type: "activo",
  level: 1,
  parent_id: null,
  is_active: true,
  system_role: null,
  eerr_category: null,
  created_at: "2026-01-01T00:00:00Z",
  created_by: null,
  updated_at: "2026-01-01T00:00:00Z",
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("../hooks/use-chart-of-accounts", () => ({
  useChartOfAccounts: () => ({ data: [account] }),
  useDeleteChartAccount: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./chart-account-dialog", () => ({ ChartAccountDialog: () => null }));

const { ChartOfAccountsTree } = await import("./chart-of-accounts-tree");

afterEach(cleanup);

describe("ChartOfAccountsTree: write controls follow accounting:write", () => {
  it.each([
    ["finance", resolveAccess(["finance"]), true],
    ["fiscal_reader", resolveAccess(["fiscal_reader"]), false],
    [
      "finance with accounting:write denied",
      resolveAccess(["finance"], ["accounting:write"]),
      false,
    ],
  ])("%s sees Nueva cuenta and the row menu: %s", (_, access, visible) => {
    render(<ChartOfAccountsTree actorAccess={access} />);
    expect(screen.getByText("Caja y bancos")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Nueva cuenta/ }) !== null,
    ).toBe(visible);
    expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
      visible,
    );
  });
});
