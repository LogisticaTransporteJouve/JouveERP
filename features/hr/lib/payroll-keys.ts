export const payrollKeys = {
  all: ["payroll"] as const,
  periods: () => [...payrollKeys.all, "periods"] as const,
  period: (year: number, month: number) =>
    [...payrollKeys.all, "period", year, month] as const,
  entries: (periodId: string) =>
    [...payrollKeys.all, "entries", periodId] as const,
  extras: (entryId: string) =>
    [...payrollKeys.all, "extras", entryId] as const,
};
