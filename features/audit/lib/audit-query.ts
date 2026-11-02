import { runAction } from "@/lib/query/run-action";

import { listAuditEventsAction } from "../actions/audit-actions";
import type { AuditCursor, AuditFilters, AuditPage } from "../schema";
import { auditKeys } from "./audit-keys";

const FIRST_PAGE: AuditCursor | null = null;

/** Shared by the page prefetch and `useAuditEvents`: both must build the
 *  same infinite shape under this key. */
export function auditEventsQuery(filters: AuditFilters) {
  return {
    queryKey: auditKeys.list(filters),
    queryFn: ({ pageParam }: { pageParam: AuditCursor | null }) =>
      runAction(() => listAuditEventsAction({ filters, cursor: pageParam })),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (lastPage: AuditPage) => lastPage.nextCursor ?? undefined,
  };
}
