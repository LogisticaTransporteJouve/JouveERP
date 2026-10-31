"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { runAction } from "@/lib/query/run-action";

import {
  createIssuedCheckAction,
  listIssuedChecksAction,
  transitionIssuedCheckAction,
  updateIssuedCheckAction,
} from "../actions/issued-checks-actions";
import { issuedChecksKeys } from "../lib/issued-checks-keys";

export function useIssuedChecksList() {
  const isFiscal = useScopeIsFiscal();
  return useSuspenseQuery({
    queryKey: issuedChecksKeys.list(isFiscal),
    queryFn: () => runAction(() => listIssuedChecksAction({ isFiscal })),
  });
}

export function useCreateIssuedCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createIssuedCheckAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issuedChecksKeys.all });
    },
  });
}

export function useUpdateIssuedCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateIssuedCheckAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issuedChecksKeys.all });
    },
  });
}

export function useTransitionIssuedCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      to_status: "cashed" | "rejected" | "cancelled";
      event_date?: string;
    }) => runAction(() => transitionIssuedCheckAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issuedChecksKeys.all });
    },
  });
}
