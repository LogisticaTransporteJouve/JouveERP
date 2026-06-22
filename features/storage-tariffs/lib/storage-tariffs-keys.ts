/** Query keys for the storage-tariffs feature. */
export const storageTariffsKeys = {
  all: ["storage-tariffs"] as const,
  list: () => [...storageTariffsKeys.all, "list"] as const,
};
