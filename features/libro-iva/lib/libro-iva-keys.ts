export const libroIvaKeys = {
  all: ["libro_iva"] as const,
  ventas: (period: string, channelId: string | null) =>
    [...libroIvaKeys.all, "ventas", { period, channelId }] as const,
  compras: (period: string, channelId: string | null) =>
    [...libroIvaKeys.all, "compras", { period, channelId }] as const,
};
