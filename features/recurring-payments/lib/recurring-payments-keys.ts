/** Query keys for the recurring-payments feature. */
export const recurringPaymentsKeys = {
  all: ["recurring-payments"] as const,
  list: (onlyActive: boolean) =>
    [...recurringPaymentsKeys.all, "list", onlyActive] as const,
};
