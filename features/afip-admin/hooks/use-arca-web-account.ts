"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  getArcaWebAccountAction,
  setArcaWebCredentialsAction,
} from "../actions/arca-web-account-actions";
import { afipAdminKeys } from "../lib/afip-admin-keys";
import type { ArcaWebCredentialsInput } from "../schema";

export function useArcaWebAccount() {
  return useSuspenseQuery({
    queryKey: afipAdminKeys.arcaWebAccount(),
    queryFn: () => runAction(() => getArcaWebAccountAction()),
  });
}

export function useSetArcaWebCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ArcaWebCredentialsInput) =>
      runAction(() => setArcaWebCredentialsAction(input)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: afipAdminKeys.arcaWebAccount() }),
  });
}
