export const searchKeys = {
  all: ["search_global"] as const,
  query: (q: string) => [...searchKeys.all, q] as const,
};
