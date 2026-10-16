/**
 * Query keys for the AI feature. Shared between client hooks so a single typo
 * doesn't make the cache miss silently.
 */
export const aiKeys = {
  all: ["ai"] as const,
  sessions: () => [...aiKeys.all, "sessions"] as const,
  sessionMessages: (id: string) =>
    [...aiKeys.all, "sessionMessages", id] as const,
  usageToday: () => [...aiKeys.all, "usageToday"] as const,
  confirmations: (sessionId: string) =>
    [...aiKeys.all, "confirmations", sessionId] as const,
  pinned: () => [...aiKeys.all, "pinned"] as const,
  pinnedView: (id: string) => [...aiKeys.pinned(), "view", id] as const,
};
