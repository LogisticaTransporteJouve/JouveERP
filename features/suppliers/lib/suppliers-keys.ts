export const SUPPLIERS_PAGE_SIZE = 50;

export const suppliersKeys = {
  all: ["suppliers"] as const,
  searchInfinite: (filters: { query: string; onlyActive: boolean }) =>
    [...suppliersKeys.all, "searchInfinite", filters] as const,
  search: (filters: { query: string; onlyActive: boolean; limit: number }) =>
    [...suppliersKeys.all, "search", filters] as const,
  byId: (id: string) => [...suppliersKeys.all, "byId", id] as const,
  references: (id: string) =>
    [...suppliersKeys.all, "references", id] as const,
};
