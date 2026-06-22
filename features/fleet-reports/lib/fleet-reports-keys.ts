export const fleetReportsKeys = {
  all: ["fleet-reports"] as const,
  profitability: (periodStart: string, periodEnd: string) =>
    [...fleetReportsKeys.all, "profitability", periodStart, periodEnd] as const,
};
