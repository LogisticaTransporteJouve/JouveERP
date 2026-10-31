export const agingKeys = {
  all: ["aging"] as const,
  summary: (isFiscal: boolean | null) =>
    [...agingKeys.all, "summary", { isFiscal }] as const,
};
