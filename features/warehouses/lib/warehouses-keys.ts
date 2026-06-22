export const warehousesKeys = {
  all: ["warehouses"] as const,
  list: (onlyActive: boolean) =>
    [...warehousesKeys.all, "list", onlyActive] as const,
};
