export const freightSettlementsKeys = {
  all: ["freight-settlements"] as const,
  list: () => [...freightSettlementsKeys.all, "list"] as const,
  detail: (id: string) =>
    [...freightSettlementsKeys.all, "detail", id] as const,
  channels: () => [...freightSettlementsKeys.all, "channels"] as const,
  candidates: (input: {
    clientId: string;
    periodStart: string;
    periodEnd: string;
    settlementId: string | null;
  }) => [...freightSettlementsKeys.all, "candidates", input] as const,
};
