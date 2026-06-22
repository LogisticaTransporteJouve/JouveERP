export const storageBillingKeys = {
  all: ["storage-billing"] as const,
  report: (periodStart: string, periodEnd: string) =>
    [...storageBillingKeys.all, "report", periodStart, periodEnd] as const,
};
