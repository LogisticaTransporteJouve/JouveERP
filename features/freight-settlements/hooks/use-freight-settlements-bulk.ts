"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { shipmentsKeys } from "@/features/shipments/lib/shipments-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import { createFreightSettlementsBulkAction } from "../actions/bulk-freight-settlements";
import type { FreightBulkInput } from "../lib/bulk";
import { freightSettlementsKeys } from "../lib/freight-settlements-keys";

export function useCreateFreightSettlementsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FreightBulkInput) =>
      runAction(() => createFreightSettlementsBulkAction(input)),
    onSuccess: () =>
      invalidateKeys(qc, [freightSettlementsKeys.all, shipmentsKeys.all]),
  });
}
