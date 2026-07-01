export const balanceKeys = {
  all: ["balance"] as const,
  saldos: (
    periodEnd: string,
    periodStart: string | null,
    costCenterId: string | null,
  ) =>
    [
      ...balanceKeys.all,
      "saldos",
      { periodEnd, periodStart, costCenterId },
    ] as const,
};
