export const warehousesKeys = {
  all: ["warehouses"] as const,
  list: (onlyActive: boolean) =>
    [...warehousesKeys.all, "list", onlyActive] as const,
};

export const storageAreasKeys = {
  all: ["storage-areas"] as const,
  list: (onlyActive: boolean) =>
    [...storageAreasKeys.all, "list", onlyActive] as const,
};
