export const libroMayorKeys = {
  all: ["libro_mayor"] as const,
  ledger: (accountId: string | null, from: string | null, to: string | null) =>
    [...libroMayorKeys.all, "ledger", { accountId, from, to }] as const,
};
