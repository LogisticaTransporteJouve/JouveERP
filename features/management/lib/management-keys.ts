import type { ManagementDrillInput, ManagementReportInput } from "../schema";

export const managementKeys = {
  all: ["management"] as const,
  report: (input: ManagementReportInput) =>
    [...managementKeys.all, "report", input] as const,
  drill: (input: ManagementDrillInput) =>
    [...managementKeys.all, "drill", input] as const,
  buckets: () => [...managementKeys.all, "buckets"] as const,
};
