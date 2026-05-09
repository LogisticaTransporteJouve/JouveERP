import { Inngest } from "inngest";

/**
 * Single Inngest client for JouveERP. Functions register against this
 * instance and the `app/api/inngest/route.ts` handler exposes them.
 *
 * `isDev: true` outside production tells the SDK to talk to the local
 * `inngest-cli dev` runtime (default `http://localhost:8288`) and skips
 * the `INNGEST_EVENT_KEY` requirement. In production we expect the env
 * vars to be set so events go to Inngest Cloud.
 *
 * Inngest v4 dropped client-side schema registration; events are validated
 * with Zod inside each function (see `lib/inngest/functions/*`).
 */
export const inngest = new Inngest({
  id: "jouve-erp",
  isDev: process.env.NODE_ENV !== "production",
});

export type InngestClient = typeof inngest;
