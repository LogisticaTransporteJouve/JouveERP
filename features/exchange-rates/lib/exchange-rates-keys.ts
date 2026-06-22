export const exchangeRatesKeys = {
  all: ["exchange_rates"] as const,
  list: () => [...exchangeRatesKeys.all, "list"] as const,
};
