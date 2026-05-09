import { Inngest } from "inngest";

/**
 * Single Inngest client for JouveERP. Functions register against this
 * instance and the `app/api/inngest/route.ts` handler exposes them.
 *
 * Typed event schemas are added per-domain when the first consumer lands
 * (e.g. `invoice.issue.requested` together with the issueInvoice function
 * in Fase E.4). Until then, events are loosely typed — that is fine, since
 * Fase E.1 only stands up the wiring.
 */
export const inngest = new Inngest({
  id: "jouve-erp",
});

export type InngestClient = typeof inngest;
