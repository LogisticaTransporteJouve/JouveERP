export const clientTariffsKeys = {
  all: ["client-tariffs"] as const,
  byClient: (clientId: string) =>
    [...clientTariffsKeys.all, "byClient", clientId] as const,
};
