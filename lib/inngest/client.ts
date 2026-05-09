import { Inngest } from "inngest";

/**
 * Single Inngest client for JouveERP. Functions register against this
 * instance and the `app/api/inngest/route.ts` handler exposes them.
 *
 * Inngest v4 dropped client-side schema registration; events are validated
 * with Zod inside each function (see `lib/inngest/functions/*`). Treating
 * the Inngest payload as untrusted at the boundary means a malformed event
 * fails loud instead of silently propagating.
 */
export const inngest = new Inngest({
  id: "jouve-erp",
});

export type InngestClient = typeof inngest;
