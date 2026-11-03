"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getGuideAction } from "../actions/guide-actions";
import {
  setGuideCollapsedAction,
  setGuideItemDoneAction,
} from "../actions/guide-state-actions";
import { guideKeys } from "../lib/guide-keys";
import type { GuideState } from "../schema";

/** Not suspense: the sidebar renders at once and the checklist fills in. */
export function useGuideState() {
  return useQuery({
    queryKey: guideKeys.state(),
    queryFn: () => runAction(() => getGuideAction()),
    staleTime: 60_000,
  });
}

export function useSetGuideCollapsed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (collapsed: boolean) =>
      runAction(() => setGuideCollapsedAction({ collapsed })),
    // Optimistic: the panel folds at once; the server keeps it for next time.
    onMutate: (collapsed) => {
      qc.setQueryData<GuideState>(guideKeys.state(), (prev) =>
        prev ? { ...prev, collapsed } : prev,
      );
    },
    onError: () => qc.invalidateQueries({ queryKey: guideKeys.state() }),
  });
}

export function useSetGuideItemDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { key: string; done: boolean }) =>
      runAction(() => setGuideItemDoneAction(input)),
    onSettled: () => qc.invalidateQueries({ queryKey: guideKeys.state() }),
  });
}
