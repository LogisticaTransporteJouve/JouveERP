export const chartOfAccountsKeys = {
  all: ["chart_of_accounts"] as const,
  list: (onlyActive: boolean) =>
    [...chartOfAccountsKeys.all, "list", { onlyActive }] as const,
};
