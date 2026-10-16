"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  listAiPinnedArtifactsAction,
  loadAiPinnedArtifactAction,
  pinAiArtifactAction,
  unpinAiArtifactAction,
  type AiPinnedView,
} from "../actions/pinned-actions";
import { pinRequestOf, type Artifact } from "../artifacts/spec";
import { aiKeys } from "../lib/ai-keys";

export function useAiPins() {
  return useSuspenseQuery({
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

/** Pins the artifact on screen (only its query and config are sent) and
 *  seeds the new pin's view with it, so the pinned page opens without a
 *  second run. */
export function usePinAiArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (artifact: Artifact) =>
      runAction(() => pinAiArtifactAction(pinRequestOf(artifact))),
    onSuccess: ({ id }, artifact) => {
      qc.setQueryData(aiKeys.pinnedView(id), {
        status: "ok",
        artifact,
      } satisfies AiPinnedView);
      void qc.invalidateQueries({ queryKey: aiKeys.pinned() });
    },
  });
}

export function useUnpinAiArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => unpinAiArtifactAction(id)),
    onSuccess: (_data, id) =>
      qc.removeQueries({ queryKey: aiKeys.pinnedView(id) }),
    onSettled: () => qc.invalidateQueries({ queryKey: aiKeys.pinned() }),
  });
}
