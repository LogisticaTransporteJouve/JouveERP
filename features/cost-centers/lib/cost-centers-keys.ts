export const costCentersKeys = {
  all: ["cost_centers"] as const,
  list: (onlyActive: boolean) =>
    [...costCentersKeys.all, "list", { onlyActive }] as const,
};
