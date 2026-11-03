import { z } from "zod";

import { IsoDateSchema } from "@/lib/validation/common";

/** Clients one "Liquidar período" run takes at most (one RPC pair each). */
export const MAX_BULK_CLIENTS = 150;

export const FreightBulkSchema = z
  .object({
    period_start: IsoDateSchema,
    period_end: IsoDateSchema,
    /** Also confirm each one (confirm_freight_settlement_document): a
     *  fiscal client's gets its Remito R; an internal one is left confirmed
     *  for its remito interno X, issued one by one. */
    confirm: z.boolean().optional(),
  })
  .refine((d) => d.period_end >= d.period_start, {
    message: "El período termina antes de empezar.",
    path: ["period_end"],
  });
export type FreightBulkInput = z.input<typeof FreightBulkSchema>;

export interface FreightBulkResult {
  /** Liquidaciones created, one per client. `unpriced`: its cargas left out for
   *  having neither flete nor flete tariff. */
  created: {
    id: string;
    client_name: string;
    cargas: number;
    total: number;
    unpriced: number;
    /** The Remito R a fiscal one got when confirmed ("R9002-00000001");
     *  null = still a draft, or internal (its X is issued later). */
    remito: string | null;
    /** Confirming was asked and failed: why (the draft stays). */
    confirm_error: string | null;
  }[];
  /** Clients with cargas in the period and no draft, and why. */
  skipped: { client_name: string; reason: string }[];
}
