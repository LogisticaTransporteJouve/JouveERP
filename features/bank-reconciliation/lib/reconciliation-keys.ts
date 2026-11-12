export const reconciliationKeys = {
  all: ["bank-reconciliation"] as const,
  view: (accountId: string, from: string, to: string) =>
    [...reconciliationKeys.all, "view", accountId, from, to] as const,
  coding: (accountId: string, from: string, to: string) =>
    [...reconciliationKeys.all, "coding", accountId, from, to] as const,
  /** Pending cuotas a debit line can pay; a line write refreshes them. */
  payableInstallments: (lineId: string) =>
    [...reconciliationKeys.all, "payable-installments", lineId] as const,
  /** Every write on statement lines: the page reads which lines are in
   *  flight from these mutations. */
  lineAction: () => [...reconciliationKeys.all, "line-action"] as const,
};
