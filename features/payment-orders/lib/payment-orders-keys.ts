export const paymentOrdersKeys = {
  all: ["payment_orders"] as const,
  list: (isFiscal: boolean | null) =>
    [...paymentOrdersKeys.all, "list", { isFiscal }] as const,
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
