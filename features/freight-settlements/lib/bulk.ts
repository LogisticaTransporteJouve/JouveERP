import { z } from "zod";

import { IsoDateSchema } from "@/lib/validation/common";

/** Clients one "Liquidar período" run takes at most (one RPC pair each). */
export const MAX_BULK_CLIENTS = 150;

export const FreightBulkSchema = z
  .object({
    period_start: IsoDateSchema,
    period_end: IsoDateSchema,
  })
  .refine((d) => d.period_end >= d.period_start, {
    message: "El período termina antes de empezar.",
    path: ["period_end"],
  });
export type FreightBulkInput = z.input<typeof FreightBulkSchema>;

export interface FreightBulkResult {
  /** Drafts created, one per client. `unpriced`: its cargas left out for
   *  having neither flete nor flete tariff. */
  created: {
    id: string;
    client_name: string;
    cargas: number;
    total: number;
    unpriced: number;
  }[];
  /** Clients with cargas in the period and no draft, and why. */
  skipped: { client_name: string; reason: string }[];
}
