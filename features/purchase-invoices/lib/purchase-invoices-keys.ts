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
  channelId: string | null;
  kind: string | null;
  excludeId: string | null;
  status: string | null;
  limit: number;
};

export type PurchaseInvoiceDuplicateLookup = {
  supplier_id: string;
  kind: string;
  punto_venta: number;
  numero: number;
};

export type NextInternalNumeroLookup = {
  channelId: string;
  supplierId: string;
  kind: string;
  puntoVenta: number;
};

export const purchaseInvoicesKeys = {
  all: ["purchase_invoices"] as const,
  searchInfinite: (filters: PurchaseInvoicesFilters) =>
    [...purchaseInvoicesKeys.all, "searchInfinite", filters] as const,
  search: (filters: PurchaseInvoicesPickerFilters) =>
    [...purchaseInvoicesKeys.all, "search", filters] as const,
  byId: (id: string) => [...purchaseInvoicesKeys.all, "byId", id] as const,
  items: (id: string) => [...purchaseInvoicesKeys.all, "items", id] as const,
  duplicate: (lookup: PurchaseInvoiceDuplicateLookup) =>
    [...purchaseInvoicesKeys.all, "duplicate", lookup] as const,
  nextInternalNumero: (lookup: NextInternalNumeroLookup) =>
    [...purchaseInvoicesKeys.all, "nextInternalNumero", lookup] as const,
  imputableRemitos: (supplierId: string) =>
    [...purchaseInvoicesKeys.all, "imputableRemitos", supplierId] as const,
};

/** The ARCA received tray: nested under `all`, so a purchase write refreshes it. */
export const arcaReceivedKeys = {
  all: [...purchaseInvoicesKeys.all, "arca_received"] as const,
  list: (status: string) => [...arcaReceivedKeys.all, "list", status] as const,
  counts: () => [...arcaReceivedKeys.all, "counts"] as const,
  syncStatus: () => [...arcaReceivedKeys.all, "sync_status"] as const,
};
