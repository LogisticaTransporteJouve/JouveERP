export const PURCHASE_INVOICES_PAGE_SIZE = 50;

export type PurchaseInvoicesFilters = {
  query: string;
  supplierId: string | null;
  channelId: string | null;
  status: string | null;
  fechaFrom: string | null;
  fechaTo: string | null;
};

export const purchaseInvoicesKeys = {
  all: ["purchase_invoices"] as const,
  searchInfinite: (filters: PurchaseInvoicesFilters) =>
    [...purchaseInvoicesKeys.all, "searchInfinite", filters] as const,
  byId: (id: string) => [...purchaseInvoicesKeys.all, "byId", id] as const,
};
