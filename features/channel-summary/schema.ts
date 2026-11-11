import { z } from "zod";

import { IsoDateSchema } from "@/lib/validation/common";

/** The Resumen of a segregated channel's section: its months between `from`
 *  and `to` (both inclusive, whole months). */
export const ChannelSummaryInputSchema = z
  .object({
    channelId: z.string().trim().min(1, "Canal requerido."),
    from: IsoDateSchema,
    to: IsoDateSchema,
  })
  .refine((v) => v.from <= v.to, {
    message: "El período es inválido.",
    path: ["to"],
  });

export type ChannelSummaryInput = z.infer<typeof ChannelSummaryInputSchema>;

/** One month of the channel: from its journal entries (sales, costs, margin)
 *  and its issued payment orders in pesos. `pendingUsd`: dollar orders with
 *  no rate, never summed into `payments`. */
export type ChannelSummaryMonth = {
  month: string;
  sales: number;
  costs: number;
  margin: number;
  payments: number;
  pendingUsd: number;
};

export type ChannelSummaryTotals = Omit<ChannelSummaryMonth, "month">;

/** The range the Resumen opens on: the twelve months up to `today`. */
export function defaultChannelSummaryRange(today: string): {
  from: string;
  to: string;
} {
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 12, 1));
  return { from: start.toISOString().slice(0, 10), to: today };
}

export function sumChannelSummary(
  months: readonly ChannelSummaryMonth[],
): ChannelSummaryTotals {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return months.reduce<ChannelSummaryTotals>(
    (acc, m) => ({
      sales: round2(acc.sales + m.sales),
      costs: round2(acc.costs + m.costs),
      margin: round2(acc.margin + m.margin),
      payments: round2(acc.payments + m.payments),
      pendingUsd: round2(acc.pendingUsd + m.pendingUsd),
    }),
    { sales: 0, costs: 0, margin: 0, payments: 0, pendingUsd: 0 },
  );
}
