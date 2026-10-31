/**
 * Query keys for the receipts feature.
 */
/** Rows the receipts list loads (the page prefetch and the hook). */
export const RECEIPTS_LIST_LIMIT = 100;

export const receiptsKeys = {
  all: ["receipts"] as const,
  list: (isFiscal: boolean | null) =>
    [...receiptsKeys.all, "list", { isFiscal }] as const,
  detail: (id: string) => [...receiptsKeys.all, "detail", id] as const,
  nextNumero: (channelId: string) =>
    [...receiptsKeys.all, "nextNumero", channelId] as const,
  usdRate: (date: string) => [...receiptsKeys.all, "usdRate", date] as const,
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
