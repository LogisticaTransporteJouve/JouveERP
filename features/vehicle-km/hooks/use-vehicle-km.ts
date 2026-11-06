"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { syncPhase } from "@/lib/afip/arca-sync-run";
import { runAction } from "@/lib/query/run-action";

import {
  getStrixStatusAction,
  requestStrixKmSyncAction,
  setStrixCredentialsAction,
} from "../actions/strix-actions";
import {
  getVehicleKmDaysAction,
  getVehicleKmRangeAction,
} from "../actions/vehicle-km-actions";
import { vehicleKmKeys } from "../lib/vehicle-km-keys";
import type { KmRangeInput, StrixCredentialsInput } from "../schema";

const POLL_MS = 3_000;

export function useVehicleKmRange(from: string, to: string) {
  return useSuspenseQuery({
    queryKey: vehicleKmKeys.range(from, to),
    queryFn: () => runAction(() => getVehicleKmRangeAction({ from, to })),
  });
}

export function useVehicleKmDays(
  vehicleId: string | null,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: vehicleKmKeys.days(vehicleId ?? "", from, to),
    queryFn: () =>
      runAction(() =>
        getVehicleKmDaysAction({ vehicle_id: vehicleId, from, to }),
      ),
    enabled: vehicleId !== null,
  });
}

/** The Strix user's state, polled while a run is queued or running; the km
 *  are read again when a run ends. */
export function useStrixStatus() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: vehicleKmKeys.strix(),
    queryFn: async () => {
      const status = await runAction(() => getStrixStatusAction());
      const before = qc.getQueryData<typeof status>(vehicleKmKeys.strix());
      if (
        before &&
        before.sync.finishedAt !== status.sync.finishedAt &&
        status.sync.finishedAt
      ) {
        void qc.invalidateQueries({
          queryKey: vehicleKmKeys.all,
          predicate: (q) => q.queryKey[1] !== "strix",
        });
      }
      return status;
    },
    refetchInterval: (query) => {
      const sync = query.state.data?.sync;
      if (!sync) return false;
      const phase = syncPhase({ ...sync, result: null }, Date.now());
      return phase === "waiting" || phase === "running" ? POLL_MS : false;
    },
  });
}

export function useRequestStrixSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KmRangeInput) =>
      runAction(() => requestStrixKmSyncAction(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: vehicleKmKeys.strix() }),
  });
}

export function useSetStrixCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StrixCredentialsInput) =>
      runAction(() => setStrixCredentialsAction(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: vehicleKmKeys.strix() }),
  });
}
