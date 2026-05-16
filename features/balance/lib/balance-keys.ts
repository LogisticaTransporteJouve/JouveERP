export const balanceKeys = {
  all: ["balance"] as const,
  saldos: (periodEnd: string, periodStart: string | null) =>
    [...balanceKeys.all, "saldos", { periodEnd, periodStart }] as const,
};
