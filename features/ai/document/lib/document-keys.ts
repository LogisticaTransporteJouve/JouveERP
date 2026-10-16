/** Query keys for the Document Intelligence tray. */
export const documentKeys = {
  all: ["ai-documents"] as const,
  pending: () => [...documentKeys.all, "pending"] as const,
  list: (status: string) => [...documentKeys.all, "list", status] as const,
  detail: (id: string) => [...documentKeys.all, "detail", id] as const,
  purchaseDraft: (id: string) =>
    [...documentKeys.all, "purchaseDraft", id] as const,
  nextNumero: (kind: string, channelId: string) =>
    [...documentKeys.all, "nextNumero", kind, channelId] as const,
};
