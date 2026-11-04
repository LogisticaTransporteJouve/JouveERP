// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  extras: {
    data: undefined as unknown[] | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-payroll", () => ({
  usePayrollEntryExtras: () => h.extras,
  useAddPayrollEntryExtra: () => ({ mutate: vi.fn(), isPending: false }),
  useRemovePayrollEntryExtra: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { PayrollExtrasDialog } = await import("./payroll-extras-dialog");

afterEach(cleanup);

function openDialog() {
  render(
    <PayrollExtrasDialog
      entryId="e1"
      employeeName="Juan Pérez"
      total={5000}
      year={2026}
      month={10}
      disabled={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /5\.000/ }));
}

describe("PayrollExtrasDialog", () => {
  it("shows a failed read with «Reintentar» instead of «Sin extras» and offers no add", () => {
    h.extras = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    };
    openDialog();
    expect(screen.getByText("No se pudieron cargar los extras.")).toBeTruthy();
    expect(screen.queryByText("Sin extras todavía.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Agregar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.extras.refetch).toHaveBeenCalled();
  });

  it("says there are none, and offers the add, when the read returns none", () => {
    h.extras = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    openDialog();
    expect(screen.getByText("Sin extras todavía.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agregar" })).toBeTruthy();
  });
});
