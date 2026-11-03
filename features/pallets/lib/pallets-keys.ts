export const palletsKeys = {
  all: ["pallets"] as const,
  list: () => [...palletsKeys.all, "list"] as const,
  blockEvents: (palletId: string) =>
    [...palletsKeys.all, "block-events", palletId] as const,
};
