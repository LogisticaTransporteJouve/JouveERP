export const fuelKeys = {
  all: ["fuel"] as const,
  list: () => [...fuelKeys.all, "list"] as const,
};
