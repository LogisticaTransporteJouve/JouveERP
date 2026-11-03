export const accountKeys = {
  all: ["employee-account"] as const,
  account: (employeeId: string) =>
    [...accountKeys.all, "account", employeeId] as const,
  salaryChanges: (employeeId: string) =>
    [...accountKeys.all, "salary-changes", employeeId] as const,
  tripExtras: (year: number, month: number) =>
    [...accountKeys.all, "trip-extras", year, month] as const,
};
