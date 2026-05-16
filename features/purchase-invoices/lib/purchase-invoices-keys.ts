export const PURCHASE_INVOICES_PAGE_SIZE = 50;

export type PurchaseInvoicesFilters = {
  query: string;
  supplierId: string | null;
  channelId: string | null;
  status: string | null;
  fechaFrom: string | null;
  fechaTo: string | null;
  isFiscal: boolean | null;
};

export type PurchaseInvoicesPickerFilters = {
  query: string;
  supplierId: string | null;
  kind: string | null;
  excludeId: string | null;
  status: string | null;
  limit: number;
};

export const purchaseInvoicesKeys = {
  all: ["purchase_invoices"] as const,
  searchInfinite: (filters: PurchaseInvoicesFilters) =>
    [...purchaseInvoicesKeys.all, "searchInfinite", filters] as const,
  search: (filters: PurchaseInvoicesPickerFilters) =>
    [...purchaseInvoicesKeys.all, "search", filters] as const,
  byId: (id: string) => [...purchaseInvoicesKeys.all, "byId", id] as const,
  items: (id: string) => [...purchaseInvoicesKeys.all, "items", id] as const,
};
