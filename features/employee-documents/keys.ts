export const employeeDocumentsKeys = {
  all: ["employee-documents"] as const,
  byEmployee: (employeeId: string) =>
    ["employee-documents", "by-employee", employeeId] as const,
  expiring: () => ["employee-documents", "expiring"] as const,
};
