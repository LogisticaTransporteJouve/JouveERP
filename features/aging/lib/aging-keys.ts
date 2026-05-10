export const agingKeys = {
  all: ["aging"] as const,
  summary: () => [...agingKeys.all, "summary"] as const,
};
