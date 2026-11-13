// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Employee } from "../schema";

const update = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../actions/employees-actions", () => ({
  getEmployeeDriverAction: async () => ({ ok: true, data: null }),
}));
vi.mock("../hooks/use-employees", () => ({
  useCreateEmployee: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEmployee: () => ({ mutate: update, isPending: false }),
}));

// Radix measures its controls; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { EmployeeForm } = await import("./employee-form");

afterEach(() => {
  cleanup();
  update.mockReset();
});

const EMPLOYEE: Employee = {
  id: "00000000-0000-4000-8000-000000000001",
  legal_name: "Juan Pérez",
  position: "Administrativo",
  cuil: null,
  cbu: null,
  pay_frequency: "mensual",
  pay_mode: "acordado",
  base_salary: 850_000,
  viatico_monthly: 20_000,
  retribucion_formal: null,
  is_monotributo: false,
  is_active: true,
  hire_date: "2020-01-01",
  termination_date: null,
  notes: null,
  convenio: null,
  categoria: null,
  obra_social: null,
  art: null,
  trip_rate_per_day: null,
  trip_rate_per_km: null,
  trip_rate_per_unload: null,
  trip_unloads_in_receipt: null,
  import_run_id: null,
  created_at: "2020-01-01T00:00:00Z",
  created_by: null,
  updated_at: "2020-01-01T00:00:00Z",
};

function renderForm() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmployeeForm mode="edit" employee={EMPLOYEE} />
    </QueryClientProvider>,
  );
}

function field(label: string): HTMLInputElement {
  const el = screen.getByLabelText(label);
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

/** Types one character at a time, the way the browser fires onChange. */
function type(el: HTMLInputElement, text: string) {
  fireEvent.change(el, { target: { value: "" } });
  for (const ch of text) {
    fireEvent.change(el, { target: { value: el.value + ch } });
  }
  fireEvent.blur(el);
}

async function saved(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(update).toHaveBeenCalled());
  return update.mock.calls[0]?.[0];
}

describe("EmployeeForm money fields", () => {
  it("shows the stored salary in es-AR format", () => {
    renderForm();
    expect(field("Sueldo base mensual").value).toBe("850.000,00");
    expect(field("Viático mensual").value).toBe("20.000,00");
  });

  it("saves an untouched salary as it was", async () => {
    renderForm();
    type(field("Apellido y nombre"), "Juan Pérez Gómez");
    expect(await saved()).toMatchObject({
      base_salary: 850_000,
      viatico_monthly: 20_000,
    });
  });

  it("saves typed es-AR amounts at face value", async () => {
    renderForm();
    type(field("Sueldo base mensual"), "1500,50");
    expect(field("Sueldo base mensual").value).toBe("1.500,50");
    type(field("Viático mensual"), "850000,00");
    expect(field("Viático mensual").value).toBe("850.000,00");
    expect(await saved()).toMatchObject({
      base_salary: 1500.5,
      viatico_monthly: 850_000,
    });
  });

  it("reads a typed dot (numpad) as the decimal mark", async () => {
    renderForm();
    type(field("Sueldo base mensual"), "1500.50");
    expect(field("Sueldo base mensual").value).toBe("1.500,50");
    expect(await saved()).toMatchObject({ base_salary: 1500.5 });
  });

  it("reads a typed thousands dot as thousands", async () => {
    renderForm();
    type(field("Sueldo base mensual"), "15.000");
    expect(field("Sueldo base mensual").value).toBe("15.000");
    expect(await saved()).toMatchObject({ base_salary: 15_000 });
  });
});
