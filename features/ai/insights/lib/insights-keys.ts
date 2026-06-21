/** Query keys for AI insights. */
export const insightsKeys = {
  all: ["ai-insights"] as const,
  list: () => [...insightsKeys.all, "list"] as const,
};
