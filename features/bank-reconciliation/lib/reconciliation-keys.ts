export const reconciliationKeys = {
  all: ["bank-reconciliation"] as const,
  accounts: () => [...reconciliationKeys.all, "accounts"] as const,
  view: (accountId: string, from: string, to: string) =>
    [...reconciliationKeys.all, "view", accountId, from, to] as const,
  coding: (accountId: string, from: string, to: string) =>
    [...reconciliationKeys.all, "coding", accountId, from, to] as const,
};
