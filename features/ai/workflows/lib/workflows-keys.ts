/** Query keys for AI tasks and the weekly summary. */
export const workflowsKeys = {
  all: ["ai-workflows"] as const,
  list: () => [...workflowsKeys.all, "list"] as const,
  runs: (workflowId: string) =>
    [...workflowsKeys.all, "runs", workflowId] as const,
  weeklySummary: () => [...workflowsKeys.all, "weekly-summary"] as const,
};
