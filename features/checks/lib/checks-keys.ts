export const checksKeys = {
  all: ["checks"] as const,
  list: (isFiscal: boolean | null) =>
    [...checksKeys.all, "list", { isFiscal }] as const,
  detail: (id: string) => [...checksKeys.all, "detail", id] as const,
  enCartera: (currency: string) =>
    [...checksKeys.all, "en_cartera", currency] as const,
};
