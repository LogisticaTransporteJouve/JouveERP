export const driversKeys = {
  all: ["drivers"] as const,
  list: (onlyActive: boolean) =>
    [...driversKeys.all, "list", onlyActive] as const,
};
