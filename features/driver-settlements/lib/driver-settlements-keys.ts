export const driverSettlementsKeys = {
  all: ["driver-settlements"] as const,
  list: () => [...driverSettlementsKeys.all, "list"] as const,
  pending: () => [...driverSettlementsKeys.all, "pending"] as const,
  accounts: () => [...driverSettlementsKeys.all, "accounts"] as const,
  detail: (id: string) => [...driverSettlementsKeys.all, "detail", id] as const,
};
