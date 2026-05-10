export const chequesKeys = {
  all: ["cheques"] as const,
  list: () => [...chequesKeys.all, "list"] as const,
  detail: (id: string) => [...chequesKeys.all, "detail", id] as const,
};
