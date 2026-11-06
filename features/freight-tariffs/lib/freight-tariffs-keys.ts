export const freightTariffsKeys = {
  all: ["freight_tariffs"] as const,
  list: () => [...freightTariffsKeys.all, "list"] as const,
};
