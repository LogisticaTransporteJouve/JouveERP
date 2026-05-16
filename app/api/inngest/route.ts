import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { agingWeeklySummary } from "@/lib/inngest/functions/aging-weekly-summary";
import { filesSweepOrphans } from "@/lib/inngest/functions/files-sweep-orphans";
import { issueInvoice } from "@/lib/inngest/functions/issue-invoice";
import { notificationsDispatch } from "@/lib/inngest/functions/notifications-dispatch";

/**
 * Inngest webhook endpoint. The dev runtime (`inngest-cli dev`) and the
 * Inngest Cloud both POST execution requests here; GET/PUT serve as
 * registration probes.
 *
 * Functions are listed inline so dead imports show up at build time. As
 * Fase E grows, each new function gets pushed to this array.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    issueInvoice,
    agingWeeklySummary,
    notificationsDispatch,
    filesSweepOrphans,
  ],
});
