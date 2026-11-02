import type { AuditFilters } from "../schema";

/** Query keys for the audit feature. */
export const auditKeys = {
  all: ["audit"] as const,
  list: (filters: AuditFilters) => [...auditKeys.all, "list", filters] as const,
  options: () => [...auditKeys.all, "options"] as const,
  record: (resourceId: string) =>
    [...auditKeys.all, "record", resourceId] as const,
};
