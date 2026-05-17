import { describe, expect, it } from "vitest";

import {
  EMPLOYEE_DOCUMENT_KINDS,
  EmployeeDocumentCreateSchema,
  getDocumentStatus,
  getDocumentStatusLabel,
  isEmployeeDocumentKind,
} from "./schema";

const EMPLOYEE_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("isEmployeeDocumentKind", () => {
  it("acepta todos los kinds del enum", () => {
    for (const k of EMPLOYEE_DOCUMENT_KINDS) {
      expect(isEmployeeDocumentKind(k)).toBe(true);
    }
  });
  it("rechaza inválidos", () => {
    expect(isEmployeeDocumentKind("bogus")).toBe(false);
    expect(isEmployeeDocumentKind(123)).toBe(false);
    expect(isEmployeeDocumentKind(null)).toBe(false);
  });
});

describe("getDocumentStatus", () => {
  it("expired si la fecha pasó", () => {
    expect(getDocumentStatus(addDays(-1))).toBe("expired");
    expect(getDocumentStatus(addDays(-365))).toBe("expired");
  });
  it("expiring_soon si vence en ≤ 30 días", () => {
    expect(getDocumentStatus(addDays(0))).toBe("expiring_soon");
    expect(getDocumentStatus(addDays(1))).toBe("expiring_soon");
    expect(getDocumentStatus(addDays(15))).toBe("expiring_soon");
    expect(getDocumentStatus(addDays(30))).toBe("expiring_soon");
  });
  it("valid si vence en > 30 días", () => {
    expect(getDocumentStatus(addDays(31))).toBe("valid");
    expect(getDocumentStatus(addDays(365))).toBe("valid");
  });
});

describe("getDocumentStatusLabel", () => {
  it("mapea cada status a texto en español", () => {
    expect(getDocumentStatusLabel("valid")).toBe("Vigente");
    expect(getDocumentStatusLabel("expiring_soon")).toBe("Por vencer");
    expect(getDocumentStatusLabel("expired")).toBe("Vencido");
  });
});

describe("EmployeeDocumentCreateSchema", () => {
  const validBase = {
    employee_id: EMPLOYEE_UUID,
    kind: "licencia_conducir" as const,
    expires_at: addDays(365),
  };

  it("acepta input mínimo", () => {
    expect(EmployeeDocumentCreateSchema.safeParse(validBase).success).toBe(true);
  });

  it("acepta input completo", () => {
    const r = EmployeeDocumentCreateSchema.safeParse({
      ...validBase,
      number: "ABC123",
      issued_at: addDays(-30),
      expires_at: addDays(365),
      issuing_authority: "Municipalidad de Tigre",
      notes: "Categoría D2",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza si expires_at < issued_at", () => {
    const r = EmployeeDocumentCreateSchema.safeParse({
      ...validBase,
      issued_at: addDays(10),
      expires_at: addDays(5),
    });
    expect(r.success).toBe(false);
  });

  it("rechaza kind inválido", () => {
    const r = EmployeeDocumentCreateSchema.safeParse({
      ...validBase,
      kind: "other",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza expires_at malformado", () => {
    const r = EmployeeDocumentCreateSchema.safeParse({
      ...validBase,
      expires_at: "2026/12/25",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza employee_id no-UUID", () => {
    const r = EmployeeDocumentCreateSchema.safeParse({
      ...validBase,
      employee_id: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });
});
