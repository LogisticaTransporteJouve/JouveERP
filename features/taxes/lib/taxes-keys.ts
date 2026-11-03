/** Query keys for the taxes feature. */
export const taxesKeys = {
  all: ["taxes"] as const,
  list: (year: number) => [...taxesKeys.all, "list", year] as const,
  accountOptions: () => [...taxesKeys.all, "account-options"] as const,
  ivaEstimate: (period: string) =>
    [...taxesKeys.all, "iva-estimate", period] as const,
};
