"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  inviteUserAction,
  listUsersAction,
  setUserRolesAction,
} from "../actions/users-actions";
import { adminUsersKeys } from "../lib/admin-users-keys";

const TWO_MINUTES = 120_000;

export function useUsersList() {
  return useSuspenseQuery({
    queryKey: adminUsersKeys.list(),
    queryFn: () => runAction(() => listUsersAction()),
    staleTime: TWO_MINUTES,
  });
}

export function useSetUserRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof setUserRolesAction>[0]) =>
      runAction(() => setUserRolesAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersKeys.all });
    },
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof inviteUserAction>[0]) =>
      runAction(() => inviteUserAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersKeys.all });
    },
  });
}
