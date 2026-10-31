export const paymentOrdersKeys = {
  all: ["payment_orders"] as const,
  list: () => [...paymentOrdersKeys.all, "list"] as const,
  detail: (id: string) => [...paymentOrdersKeys.all, "detail", id] as const,
  nextNumero: (channelId: string) =>
    [...paymentOrdersKeys.all, "nextNumero", channelId] as const,
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
