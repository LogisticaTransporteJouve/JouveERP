import { runAction } from "@/lib/query/run-action";

import { getCashFlowAction } from "../actions/cash-flow-actions";
import { getTreasurySummaryAction } from "../actions/treasury-actions";
import { treasuryKeys } from "./treasury-keys";

/** Shared by the pages' prefetch and the hooks, so both use one key. */
export const CASH_FLOW_MONTHS = { back: 3, fwd: 6 } as const;

export function treasurySummaryQuery() {
  return {
    queryKey: treasuryKeys.summary(),
    queryFn: () => runAction(() => getTreasurySummaryAction()),
    staleTime: 30_000,
  };
}

export function cashFlowQuery(monthsBack: number, monthsFwd: number) {
  return {
    queryKey: treasuryKeys.cashFlow(monthsBack, monthsFwd),
    queryFn: () =>
      runAction(() => getCashFlowAction({ monthsBack, monthsFwd })),
    staleTime: 30_000,
  };
}
