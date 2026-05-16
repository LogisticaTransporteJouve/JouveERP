export const inflationKeys = {
  all: ["inflation_adjustments"] as const,
  list: () => [...inflationKeys.all, "list"] as const,
};
