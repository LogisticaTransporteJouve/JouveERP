export const attendanceKeys = {
  all: ["attendance"] as const,
  month: (year: number, month: number) =>
    [...attendanceKeys.all, "month", year, month] as const,
  employees: () => [...attendanceKeys.all, "employees"] as const,
};
