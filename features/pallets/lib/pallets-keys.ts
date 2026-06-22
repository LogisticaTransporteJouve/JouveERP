export const palletsKeys = {
  all: ["pallets"] as const,
  list: () => [...palletsKeys.all, "list"] as const,
};
