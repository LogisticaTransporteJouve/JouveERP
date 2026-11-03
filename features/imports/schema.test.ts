import { describe, expect, it } from "vitest";

import { IMPORT_FIELDS } from "./lib/fields";
import { normalizeHeader } from "@/lib/tables/columns";
import {
  HistoricPayrollListSchema,
  HistoricPayrollRowSchema,
  HistoricTripRowSchema,
  HistoricTripsListSchema,
  IMPORT_KINDS,
  ImportRequestSchema,
  UndoImportRunSchema,
  isImportKind,
} from "./schema";

const ID = "6f1c9f0e-3b5d-4c2a-9e8f-1a2b3c4d5e6f";

describe("ImportRequestSchema", () => {
  it("takes a kind and an optional mapping", () => {
    expect(
      ImportRequestSchema.safeParse({ kind: "clients", mapping: null }).success,
    ).toBe(true);
    expect(
      ImportRequestSchema.safeParse({
        kind: "historic_trips",
        mapping: { trip_date: 0, km: 3 },
      }).success,
    ).toBe(true);
    expect(
      ImportRequestSchema.safeParse({ kind: "invoices", mapping: null })
        .success,
    ).toBe(false);
    expect(
      ImportRequestSchema.safeParse({
        kind: "clients",
        mapping: { legal_name: -1 },
      }).success,
    ).toBe(false);
  });

  it("knows every kind", () => {
    for (const kind of IMPORT_KINDS) expect(isImportKind(kind)).toBe(true);
    expect(isImportKind("payroll")).toBe(false);
  });
});

describe("list and undo inputs", () => {
  it("validates ids, years and months", () => {
    expect(UndoImportRunSchema.safeParse({ id: ID }).success).toBe(true);
    expect(UndoImportRunSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(HistoricPayrollListSchema.safeParse({ year: 2025 }).success).toBe(
      true,
    );
    expect(HistoricPayrollListSchema.safeParse({ year: 25 }).success).toBe(
      false,
    );
    expect(
      HistoricTripsListSchema.safeParse({ month: "2025-03" }).success,
    ).toBe(true);
    expect(
      HistoricTripsListSchema.safeParse({ month: "2025-13" }).success,
    ).toBe(false);
  });
});

describe("historic rows", () => {
  const payroll = {
    employee_id: ID,
    period: "2025-06",
    kind: "sac",
    net_amount: 100,
    paid_amount: null,
    paid_on: null,
    notes: null,
  };

  it("an aguinaldo is of June or December, like the payroll_periods check", () => {
    expect(HistoricPayrollRowSchema.safeParse(payroll).success).toBe(true);
    expect(
      HistoricPayrollRowSchema.safeParse({ ...payroll, period: "2025-05" })
        .success,
    ).toBe(false);
    expect(
      HistoricPayrollRowSchema.safeParse({ ...payroll, net_amount: -1 })
        .success,
    ).toBe(false);
  });

  it("a trip needs a date and its hash", () => {
    const trip = {
      trip_date: "2025-03-10",
      vehicle_id: null,
      vehicle_label: "AB123CD",
      driver_id: null,
      driver_label: null,
      client_id: null,
      client_label: null,
      origin: "Rosario",
      destination: null,
      km: 10,
      freight_amount: null,
      notes: null,
      source_hash: "a".repeat(64),
    };
    expect(HistoricTripRowSchema.safeParse(trip).success).toBe(true);
    expect(
      HistoricTripRowSchema.safeParse({ ...trip, source_hash: "abc" }).success,
    ).toBe(false);
    expect(HistoricTripRowSchema.safeParse({ ...trip, km: -5 }).success).toBe(
      false,
    );
  });
});

describe("IMPORT_FIELDS", () => {
  it("writes every alias normalized and each key once per kind", () => {
    for (const kind of IMPORT_KINDS) {
      const keys = IMPORT_FIELDS[kind].map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const field of IMPORT_FIELDS[kind]) {
        expect(field.aliases.length).toBeGreaterThan(0);
        for (const alias of field.aliases) {
          expect(normalizeHeader(alias)).toBe(alias);
        }
      }
    }
  });
});
