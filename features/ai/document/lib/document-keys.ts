/** Query keys for the Document Intelligence tray. */
export const documentKeys = {
  all: ["ai-documents"] as const,
  pending: () => [...documentKeys.all, "pending"] as const,
  detail: (id: string) => [...documentKeys.all, "detail", id] as const,
};
