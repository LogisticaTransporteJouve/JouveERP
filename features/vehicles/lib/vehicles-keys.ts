export const vehiclesKeys = {
  all: ["vehicles"] as const,
  list: (onlyActive: boolean) =>
    [...vehiclesKeys.all, "list", onlyActive] as const,
};
