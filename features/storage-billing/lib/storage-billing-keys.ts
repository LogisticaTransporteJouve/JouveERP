export const storageBillingKeys = {
  all: ["storage-billing"] as const,
  report: (periodStart: string, periodEnd: string) =>
    [...storageBillingKeys.all, "report", periodStart, periodEnd] as const,
  runs: () => [...storageBillingKeys.all, "runs"] as const,
  channels: () => [...storageBillingKeys.all, "channels"] as const,
  pos: (channelId: string) =>
    [...storageBillingKeys.all, "pos", channelId] as const,
};
