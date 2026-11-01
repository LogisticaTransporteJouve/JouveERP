import type { PaymentOrderListFilters } from "./payment-order-list-filters";

/** Rows per page of the payment orders list (the page prefetch and the hook). */
export const PAYMENT_ORDERS_PAGE_SIZE = 50;

export const paymentOrdersKeys = {
  all: ["payment_orders"] as const,
  searchInfinite: (filters: PaymentOrderListFilters) =>
    [...paymentOrdersKeys.all, "searchInfinite", filters] as const,
  detail: (id: string) => [...paymentOrdersKeys.all, "detail", id] as const,
  nextNumero: (channelId: string) =>
    [...paymentOrdersKeys.all, "nextNumero", channelId] as const,
  usdRate: (date: string) =>
    [...paymentOrdersKeys.all, "usdRate", date] as const,
  pendingInvoices: (
    supplierId: string,
    channelId: string,
    excludePaymentOrderId?: string,
  ) =>
    [
      ...paymentOrdersKeys.all,
      "pendingInvoices",
      supplierId,
      channelId,
      excludePaymentOrderId ?? null,
    ] as const,
};
