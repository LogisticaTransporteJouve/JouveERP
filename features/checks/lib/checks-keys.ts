export const checksKeys = {
  all: ["checks"] as const,
  list: () => [...checksKeys.all, "list"] as const,
  detail: (id: string) => [...checksKeys.all, "detail", id] as const,
};
