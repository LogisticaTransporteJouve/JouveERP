/** Query keys for the recurring-payments feature. */
export const recurringPaymentsKeys = {
  all: ["recurring-payments"] as const,
  list: (onlyActive: boolean, isFiscal: boolean | null) =>
    [...recurringPaymentsKeys.all, "list", onlyActive, { isFiscal }] as const,
};
