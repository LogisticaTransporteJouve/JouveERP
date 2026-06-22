export const maintenanceKeys = {
  all: ["maintenance"] as const,
  list: () => [...maintenanceKeys.all, "list"] as const,
};
