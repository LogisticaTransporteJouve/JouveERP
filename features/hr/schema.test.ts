import { describe, expect, it } from "vitest";

import {
  EmployeeCreateSchema,
  EmployeeReactivateSchema,
  EmployeeTerminateSchema,
  EmployeeUpdateSchema,
  isPayFrequency,
} from "./schema";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("isPayFrequency", () => {
  it("true para semanal/mensual/mixto", () => {
    expect(isPayFrequency("semanal")).toBe(true);
    expect(isPayFrequency("mensual")).toBe(true);
    expect(isPayFrequency("mixto")).toBe(true);
  });
  it("false para otros", () => {
    expect(isPayFrequency("diaria")).toBe(false);
    expect(isPayFrequency(undefined)).toBe(false);
  });
});

describe("EmployeeCreateSchema", () => {
  const valid = {
    legal_name: "Juan Pérez",
    pay_frequency: "mensual" as const,
    viatico_monthly: 0,
    is_monotributo: false,
    hire_date: "2026-01-15",
  };

  it("acepta payload válido", () => {
    expect(EmployeeCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza legal_name < 2 chars", () => {
    expect(
      EmployeeCreateSchema.safeParse({ ...valid, legal_name: "X" }).success,
    ).toBe(false);
  });

  it("rechaza pay_frequency desconocido", () => {
    expect(
      EmployeeCreateSchema.safeParse({ ...valid, pay_frequency: "diario" })
        .success,
    ).toBe(false);
  });

  it("rechaza CUIL no de 11 dígitos", () => {
    expect(
      EmployeeCreateSchema.safeParse({ ...valid, cuil: "123" }).success,
    ).toBe(false);
  });

  it("acepta CUIL de 11 dígitos", () => {
    expect(
      EmployeeCreateSchema.safeParse({ ...valid, cuil: "20123456789" })
        .success,
    ).toBe(true);
  });

  it("acepta CBU de 22 dígitos", () => {
    expect(
      EmployeeCreateSchema.safeParse({
        ...valid,
        cbu: "0123456789012345678901",
      }).success,
    ).toBe(true);
  });

  it("rechaza CBU con menos de 22 dígitos", () => {
    expect(
      EmployeeCreateSchema.safeParse({ ...valid, cbu: "12345678901" }).success,
    ).toBe(false);
  });

  it("rechaza viatico_monthly negativo", () => {
    expect(
      EmployeeCreateSchema.safeParse({ ...valid, viatico_monthly: -10 })
        .success,
    ).toBe(false);
  });

  it("rechaza hire_date mal formada", () => {
    expect(
      EmployeeCreateSchema.safeParse({ ...valid, hire_date: "15/01/2026" })
        .success,
    ).toBe(false);
  });

  it("base_salary acepta vacío como null", () => {
    const res = EmployeeCreateSchema.safeParse({ ...valid, base_salary: "" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.base_salary).toBe(null);
  });
});

describe("EmployeeUpdateSchema", () => {
  it("requiere id UUID", () => {
    expect(
      EmployeeUpdateSchema.safeParse({ id: "x", legal_name: "Juan" }).success,
    ).toBe(false);
  });
});

describe("EmployeeTerminateSchema", () => {
  it("acepta payload completo", () => {
    expect(
      EmployeeTerminateSchema.safeParse({
        id: UUID,
        termination_date: "2026-05-17",
      }).success,
    ).toBe(true);
  });

  it("rechaza fecha mal formada", () => {
    expect(
      EmployeeTerminateSchema.safeParse({
        id: UUID,
        termination_date: "17/05/2026",
      }).success,
    ).toBe(false);
  });
});

describe("EmployeeReactivateSchema", () => {
  it("acepta payload", () => {
    expect(EmployeeReactivateSchema.safeParse({ id: UUID }).success).toBe(true);
  });
});
