export const shipmentsKeys = {
  all: ["shipments"] as const,
  list: () => [...shipmentsKeys.all, "list"] as const,
  options: () => [...shipmentsKeys.all, "options"] as const,
  history: (id: string) => [...shipmentsKeys.all, "history", id] as const,
  byTrip: (tripId: string) => [...shipmentsKeys.all, "byTrip", tripId] as const,
  unassigned: () => [...shipmentsKeys.all, "unassigned"] as const,
  remitoConflict: (check: {
    clientId: string;
    remitoNumber: string;
    excludeId: string | null;
  }) => [...shipmentsKeys.all, "remitoConflict", check] as const,
};
