// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A native select stands in for Radix Select, which jsdom cannot open.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, children }: { value: string; children: ReactNode }) => (
    <select value={value} onChange={() => {}}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("../hooks/use-cost-centers", () => ({
  useCostTagOptions: () => ({
    isPending: false,
    isSuccess: true,
    isError: false,
    data: {
      expenseAccounts: [],
      costCenters: [{ id: "c-admin", code: "ADMIN", name: "Administración" }],
      inactiveCostCenters: [{ id: "c-dz", code: "FLOTA_DZ", name: "Flota DZ" }],
    },
  }),
}));

const { CostTagSelect } = await import("./cost-tag-select");

afterEach(cleanup);

describe("CostTagSelect · inactive centers", () => {
  it("is not offered for a new selection", () => {
    render(<CostTagSelect kind="costCenter" value="" onChange={() => {}} />);
    expect(
      screen.getByRole("option", { name: "ADMIN Administración" }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: /FLOTA_DZ/ })).toBeNull();
  });

  it("keeps a saved one by name, marked (inactivo)", () => {
    render(
      <CostTagSelect kind="costCenter" value="c-dz" onChange={() => {}} />,
    );
    expect(
      screen.getByRole("option", { name: "FLOTA_DZ Flota DZ (inactivo)" }),
    ).toBeTruthy();
    expect(screen.getByRole("combobox")).toHaveProperty("value", "c-dz");
  });
});
