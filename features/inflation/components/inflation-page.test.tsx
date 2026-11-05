// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import type { InflationAdjustment } from "../schema";

const base: InflationAdjustment = {
  id: "i1",
  period: "2026-09",
  coefficient: 1.05,
  index_source: null,
  notes: null,
  applied_at: null,
  applied_by: null,
  journal_entry_id: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};
const rows: InflationAdjustment[] = [
  base,
  {
    ...base,
    id: "i2",
    period: "2026-08",
    journal_entry_id: "j1",
    applied_at: "2026-09-02T00:00:00Z",
  },
];

const mutation = () => ({ mutate: vi.fn(), isPending: false });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("@/features/journal-entries/components/manual-entry-dialog", () => ({
  ManualEntryDialog: () => null,
}));
vi.mock("../hooks/use-inflation", () => ({
  useInflationAdjustments: () => ({ data: rows }),
  useCreateInflationAdjustment: mutation,
  useDeleteInflationAdjustment: mutation,
  useApplyInflationAdjustment: mutation,
  useRevertInflationApplication: mutation,
}));

const { InflationPage } = await import("./inflation-page");

afterEach(cleanup);

describe("InflationPage: write controls follow accounting:write", () => {
  it.each([
    ["finance", resolveAccess(["finance"]), true],
    ["fiscal_reader", resolveAccess(["fiscal_reader"]), false],
    [
      "finance with accounting:write denied",
      resolveAccess(["finance"], ["accounting:write"]),
      false,
    ],
  ])("%s sees the write controls: %s", (_, access, visible) => {
    render(<InflationPage actorAccess={access} />);
    expect(screen.getByText("2026-09")).toBeTruthy();
    for (const name of [
      /Cargar coeficiente/,
      /Generar asiento/,
      /Desvincular/,
    ]) {
      expect(screen.queryByRole("button", { name }) !== null).toBe(visible);
    }
    expect(screen.queryAllByRole("button", { name: "Borrar" }).length).toBe(
      visible ? 2 : 0,
    );
  });
});
