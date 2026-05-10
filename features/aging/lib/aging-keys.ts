/**
 * Query keys for the aging feature. Aging is computed by the
 * `v_client_aging` and `v_aging_documents` views — keys mirror those
 * shapes so invalidation can target either the per-client summary or
 * the per-document detail.
 */
export const agingKeys = {
  all: ["aging"] as const,
  summary: () => [...agingKeys.all, "summary"] as const,
  documents: (clientId: string) =>
    [...agingKeys.all, "documents", clientId] as const,
};
