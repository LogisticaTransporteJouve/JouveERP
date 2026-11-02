"use client";

import {
  useMutation,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { runAction } from "@/lib/query/run-action";

import {
  exportAuditEventsCsvAction,
  getRecordHistoryAction,
  listAuditFilterOptionsAction,
} from "../actions/audit-actions";
import { auditKeys } from "../lib/audit-keys";
import { auditEventsQuery } from "../lib/audit-query";
import type { AuditFilters } from "../schema";

export function useAuditEvents(filters: AuditFilters) {
  const query = useSuspenseInfiniteQuery(auditEventsQuery(filters));
  const rows = useMemo(
    () => query.data.pages.flatMap((p) => p.rows),
    [query.data],
  );
  return { ...query, rows };
}

export function useAuditFilterOptions() {
  return useSuspenseQuery({
    queryKey: auditKeys.options(),
    queryFn: () => runAction(() => listAuditFilterOptionsAction()),
    staleTime: 5 * 60_000,
  });
}

/** User id → display name, for the "Quién" column. */
export function useAuditUserNames(): ReadonlyMap<string, string> {
  const { data } = useAuditFilterOptions();
  return useMemo(
    () => new Map(data.users.map((u) => [u.id, u.label])),
    [data.users],
  );
}

export function useRecordHistory(resourceId: string) {
  return useSuspenseQuery({
    queryKey: auditKeys.record(resourceId),
    queryFn: () => runAction(() => getRecordHistoryAction(resourceId)),
  });
}

export function useExportAuditCsv() {
  return useMutation({
    mutationFn: (filters: AuditFilters) =>
      runAction(() => exportAuditEventsCsvAction(filters)),
  });
}
