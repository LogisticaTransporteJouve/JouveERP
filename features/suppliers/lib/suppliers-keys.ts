export const SUPPLIERS_PAGE_SIZE = 50;

export type SuppliersSearchFilters = {
  query: string;
  onlyActive: boolean;
  categoryId: string | null;
};

export const suppliersKeys = {
  all: ["suppliers"] as const,
  searchInfinite: (filters: SuppliersSearchFilters) =>
    [...suppliersKeys.all, "searchInfinite", filters] as const,
  search: (filters: { query: string; onlyActive: boolean; limit: number }) =>
    [...suppliersKeys.all, "search", filters] as const,
  byId: (id: string) => [...suppliersKeys.all, "byId", id] as const,
  references: (id: string) => [...suppliersKeys.all, "references", id] as const,
  account: (id: string) => [...suppliersKeys.all, "account", id] as const,
  accountByScope: (id: string, isFiscal: boolean | null) =>
    [...suppliersKeys.account(id), { isFiscal }] as const,
  aging: (isFiscal: boolean | null) =>
    [...suppliersKeys.all, "aging", { isFiscal }] as const,
  openingBalance: (id: string) =>
    [...suppliersKeys.all, "openingBalance", id] as const,
};
