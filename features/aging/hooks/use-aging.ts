"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  getAgingDocumentsAction,
  getAgingSummaryAction,
} from "../actions/aging-actions";
import { agingKeys } from "../lib/aging-keys";

export function useAgingSummary() {
  return useSuspenseQuery({
    queryKey: agingKeys.summary(),
    queryFn: () => runAction(() => getAgingSummaryAction()),
  });
}

export function useAgingDocuments(clientId: string) {
  return useSuspenseQuery({
    queryKey: agingKeys.documents(clientId),
    queryFn: () => runAction(() => getAgingDocumentsAction(clientId)),
  });
}
