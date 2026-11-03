import type { PayrollPeriodKind } from "../payroll-schema";

export const payrollKeys = {
  all: ["payroll"] as const,
  periods: () => [...payrollKeys.all, "periods"] as const,
  /** Prefix of every planilla of the month (monthly and SAC). */
  period: (year: number, month: number) =>
    [...payrollKeys.all, "period", year, month] as const,
  periodOfKind: (year: number, month: number, kind: PayrollPeriodKind) =>
    [...payrollKeys.period(year, month), kind] as const,
  entries: (periodId: string) =>
    [...payrollKeys.all, "entries", periodId] as const,
  extras: (entryId: string) => [...payrollKeys.all, "extras", entryId] as const,
  garnishments: (employeeId: string) =>
    [...payrollKeys.all, "garnishments", employeeId] as const,
  finalSettlement: (employeeId: string) =>
    [...payrollKeys.all, "final-settlement", employeeId] as const,
};
