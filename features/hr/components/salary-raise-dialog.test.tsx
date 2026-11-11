// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/month-picker", () => ({ MonthPicker: () => null }));
vi.mock("../hooks/use-employee-account", () => ({
  useApplySalaryRaise: () => ({ mutate: h.mutate, isPending: false }),
}));
vi.mock("../hooks/use-employees", () => ({
  useEmployeesList: () => ({
    data: [
      {
        id: "e1",
        legal_name: "Alejo Mauro",
        is_active: true,
        base_salary: 1000,
        position: "Chofer",
        convenio: null,
        pay_mode: "acordado",
      },
      {
        id: "e2",
        legal_name: "Baez Martin",
        is_active: true,
        base_salary: 2000,
        position: "Chofer",
        convenio: null,
        pay_mode: "acordado",
      },
      {
        id: "e3",
        legal_name: "Casco Maximiliano",
        is_active: true,
        base_salary: 3000,
        position: "Mecánico",
        convenio: null,
        pay_mode: "acordado",
      },
      {
        id: "e4",
        legal_name: "Olmedo Recibo",
        is_active: true,
        base_salary: 4000,
        position: "Chofer",
        convenio: null,
        pay_mode: "recibo",
      },
    ],
  }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { SalaryRaiseDialog } = await import("./salary-raise-dialog");

afterEach(() => {
  cleanup();
  h.mutate.mockReset();
});

function open() {
  render(<SalaryRaiseDialog />);
  fireEvent.click(screen.getByRole("button", { name: /Aumento/ }));
  fireEvent.change(screen.getByLabelText("Aumento (%)"), {
    target: { value: "3" },
  });
}

describe("SalaryRaiseDialog", () => {
  it("leaves out the employees the user unticks", () => {
    open();
    expect(screen.getByText(/3 de 3 empleado/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Baez Martin/ }));
    expect(screen.getByText(/2 de 3 empleado/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar aumento" }));
    expect(h.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ employee_ids: ["e1", "e3"] }),
      expect.anything(),
    );
  });

  it("leaves out the employees paid por recibo", () => {
    open();
    expect(
      screen.queryByRole("checkbox", { name: /Olmedo Recibo/ }),
    ).toBeNull();
    expect(screen.getByText(/Los empleados por recibo no entran/)).toBeTruthy();
  });

  it("cannot apply with nobody ticked", () => {
    open();
    fireEvent.click(screen.getByLabelText("Elegir todos"));
    expect(screen.getByText(/0 de 3 empleado/)).toBeTruthy();
    const apply = screen.getByRole("button", { name: "Aplicar aumento" });
    expect(apply.hasAttribute("disabled")).toBe(true);
  });
});
