import type { ManagementReportInput } from "../schema";

export const managementKeys = {
  all: ["management"] as const,
  report: (input: ManagementReportInput) =>
    [...managementKeys.all, "report", input] as const,
  buckets: () => [...managementKeys.all, "buckets"] as const,
};
