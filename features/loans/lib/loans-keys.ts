export const loansKeys = {
  all: ["loans"] as const,
  list: (isFiscal: boolean | null) =>
    [...loansKeys.all, "list", { isFiscal }] as const,
  detail: (id: string) => [...loansKeys.all, "detail", id] as const,
  usdRate: (date: string) => [...loansKeys.all, "usd-rate", date] as const,
};
