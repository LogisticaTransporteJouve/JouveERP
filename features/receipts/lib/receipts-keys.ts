/**
 * Query keys for the receipts feature.
 */
export const receiptsKeys = {
  all: ["receipts"] as const,
  list: () => [...receiptsKeys.all, "list"] as const,
  detail: (id: string) => [...receiptsKeys.all, "detail", id] as const,
  nextNumero: (channelId: string) =>
    [...receiptsKeys.all, "nextNumero", channelId] as const,
  pendingComprobantes: (
    clientId: string,
    channelId: string,
    excludeReceiptId?: string,
  ) =>
    [
      ...receiptsKeys.all,
      "pendingComprobantes",
      clientId,
      channelId,
      excludeReceiptId ?? null,
    ] as const,
};
