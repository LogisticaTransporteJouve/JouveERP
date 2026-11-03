export const lateInterestKeys = {
  all: ["late-interest"] as const,
  candidates: (asOf: string, isFiscal: boolean | null) =>
    [...lateInterestKeys.all, "candidates", asOf, isFiscal] as const,
  settings: () => [...lateInterestKeys.all, "settings"] as const,
};
