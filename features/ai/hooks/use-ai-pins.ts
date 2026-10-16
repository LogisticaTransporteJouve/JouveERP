"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  listAiPinnedArtifactsAction,
  loadAiPinnedArtifactAction,
  pinAiArtifactAction,
  unpinAiArtifactAction,
} from "../actions/pinned-actions";
import type { PinRequest } from "../artifacts/spec";
import { aiKeys } from "../lib/ai-keys";

export function useAiPins() {
  return useQuery({
    queryKey: aiKeys.pinned(),
    queryFn: () => runAction(() => listAiPinnedArtifactsAction()),
  });
}

/** One pin recomputed now, as the viewer. */
export function useAiPinnedView(id: string) {
  return useQuery({
    queryKey: aiKeys.pinnedView(id),
    queryFn: () => runAction(() => loadAiPinnedArtifactAction(id)),
  });
}

export function usePinAiArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: PinRequest) =>
      runAction(() => pinAiArtifactAction(request)),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKeys.pinned() }),
  });
}

export function useUnpinAiArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => unpinAiArtifactAction(id)),
    onSettled: () => qc.invalidateQueries({ queryKey: aiKeys.pinned() }),
  });
}
