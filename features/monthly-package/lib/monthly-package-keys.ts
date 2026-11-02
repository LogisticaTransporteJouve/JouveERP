/** Query keys for the monthly package. */
export const monthlyPackageKeys = {
  all: ["monthly-package"] as const,
  status: (period: string) =>
    [...monthlyPackageKeys.all, "status", period] as const,
};
