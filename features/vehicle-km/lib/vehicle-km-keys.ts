export const vehicleKmKeys = {
  all: ["vehicle-km"] as const,
  range: (from: string, to: string) =>
    [...vehicleKmKeys.all, "range", from, to] as const,
  days: (vehicleId: string, from: string, to: string) =>
    [...vehicleKmKeys.all, "days", vehicleId, from, to] as const,
  strix: () => [...vehicleKmKeys.all, "strix"] as const,
};
