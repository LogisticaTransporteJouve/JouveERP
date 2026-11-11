export const SUPPLIERS_PAGE_SIZE = 50;

export type SuppliersSearchFilters = {
  query: string;
  onlyActive: boolean;
  categoryId: string | null;
  isFiscal: boolean | null;
  /** A segregated channel's section: only its suppliers. */
  channelId?: string | null;
};

export const suppliersKeys = {
  all: ["suppliers"] as const,
  searchInfinite: (filters: SuppliersSearchFilters) =>
    [...suppliersKeys.all, "searchInfinite", filters] as const,
  search: (filters: {
    query: string;
    onlyActive: boolean;
    limit: number;
    isFiscal: boolean | null;
  }) => [...suppliersKeys.all, "search", filters] as const,
  byId: (id: string) => [...suppliersKeys.all, "byId", id] as const,
  pickerAccess: () => [...suppliersKeys.all, "pickerAccess"] as const,
  references: (id: string) => [...suppliersKeys.all, "references", id] as const,
  account: (id: string) => [...suppliersKeys.all, "account", id] as const,
  accountByScope: (
    id: string,
    isFiscal: boolean | null,
    channelId: string | null = null,
  ) => [...suppliersKeys.account(id), { isFiscal, channelId }] as const,
  aging: (isFiscal: boolean | null, channelId: string | null = null) =>
    [...suppliersKeys.all, "aging", { isFiscal, channelId }] as const,
  openingBalance: (id: string) =>
    [...suppliersKeys.all, "openingBalance", id] as const,
};
