"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  getUserAccessAction,
  inviteUserAction,
  listUsersAction,
  setUserAccessAction,
} from "../actions/users-actions";
import { adminUsersKeys } from "../lib/admin-users-keys";
import type { SetAccessInput } from "../schema";

const TWO_MINUTES = 120_000;

export function useUsersList() {
  return useSuspenseQuery({
    queryKey: adminUsersKeys.list(),
    queryFn: () => runAction(() => listUsersAction()),
    staleTime: TWO_MINUTES,
  });
}

/** One user's roles and denies, read fresh each time the dialog opens. */
export function useUserAccess(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: adminUsersKeys.access(userId),
    queryFn: () => runAction(() => getUserAccessAction(userId)),
    enabled,
    staleTime: 0,
  });
}

export function useSetUserAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetAccessInput) =>
      runAction(() => setUserAccessAction(input)),
    onSettled: () => {
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
