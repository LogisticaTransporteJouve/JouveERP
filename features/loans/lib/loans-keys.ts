export const loansKeys = {
  all: ["loans"] as const,
  list: () => [...loansKeys.all, "list"] as const,
  detail: (id: string) => [...loansKeys.all, "detail", id] as const,
};
