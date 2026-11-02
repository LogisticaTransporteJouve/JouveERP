export const vehicleKmKeys = {
  all: ["vehicle-km"] as const,
  month: (period: string) => [...vehicleKmKeys.all, "month", period] as const,
};
