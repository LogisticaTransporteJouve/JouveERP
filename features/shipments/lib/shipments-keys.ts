import type { ShipmentListFilter } from "../schema";

export const shipmentsKeys = {
  all: ["shipments"] as const,
  list: (filter?: ShipmentListFilter) =>
    [...shipmentsKeys.all, "list", filter ?? {}] as const,
  history: (id: string) => [...shipmentsKeys.all, "history", id] as const,
  byTrip: (tripId: string) => [...shipmentsKeys.all, "byTrip", tripId] as const,
  unassigned: () => [...shipmentsKeys.all, "unassigned"] as const,
};
