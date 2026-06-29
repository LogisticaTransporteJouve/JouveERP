export const treasuryKeys = {
  all: ["treasury"] as const,
  summary: () => ["treasury", "summary"] as const,
  cashFlow: (monthsBack: number, monthsFwd: number) =>
    ["treasury", "cash-flow", monthsBack, monthsFwd] as const,
};
