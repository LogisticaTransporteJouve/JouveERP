export const importsKeys = {
  all: ["imports"] as const,
  runs: () => [...importsKeys.all, "runs"] as const,
  historicPayroll: (year: number) =>
    [...importsKeys.all, "historic-payroll", year] as const,
  historicTrips: (month: string) =>
    [...importsKeys.all, "historic-trips", month] as const,
};
