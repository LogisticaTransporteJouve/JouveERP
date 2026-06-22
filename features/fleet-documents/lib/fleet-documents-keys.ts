export const fleetDocumentsKeys = {
  all: ["fleet-documents"] as const,
  list: () => [...fleetDocumentsKeys.all, "list"] as const,
};
