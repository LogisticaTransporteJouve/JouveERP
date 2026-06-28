export const shipmentsKeys = {
  all: ["shipments"] as const,
  list: () => [...shipmentsKeys.all, "list"] as const,
  options: () => [...shipmentsKeys.all, "options"] as const,
  history: (id: string) => [...shipmentsKeys.all, "history", id] as const,
  byTrip: (tripId: string) => [...shipmentsKeys.all, "byTrip", tripId] as const,
};
