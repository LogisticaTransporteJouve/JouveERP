import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { agingWeeklySummary } from "@/lib/inngest/functions/aging-weekly-summary";
import { aiAnalyst } from "@/lib/inngest/functions/ai-analyst";
import {
  aiWeeklySummary,
  aiWeeklySummaryFanOut,
} from "@/lib/inngest/functions/ai-weekly-summary";
import { aiWorkflowRun } from "@/lib/inngest/functions/ai-workflow-run";
import { aiWorkflowsMaterialize } from "@/lib/inngest/functions/ai-workflows-materialize";
import { arcaIssuedSync } from "@/lib/inngest/functions/arca-issued-sync";
import { bcraExchangeRate } from "@/lib/inngest/functions/bcra-exchange-rate";
import { caeaInform } from "@/lib/inngest/functions/caea-inform";
import { caeaRequest } from "@/lib/inngest/functions/caea-request";
import { documentExpiryAlerts } from "@/lib/inngest/functions/document-expiry-alerts";
import { documentExtraction } from "@/lib/inngest/functions/document-extraction";
import { fleetDocumentExpiryAlerts } from "@/lib/inngest/functions/fleet-document-expiry-alerts";
import { filesSweepOrphans } from "@/lib/inngest/functions/files-sweep-orphans";
import { issueInvoice } from "@/lib/inngest/functions/issue-invoice";
import { notificationsDispatch } from "@/lib/inngest/functions/notifications-dispatch";
import { searchIndexRefresh } from "@/lib/inngest/functions/search-index-refresh";
import { ttlCleanup } from "@/lib/inngest/functions/ttl-cleanup";
import { vacationBalancesGrant } from "@/lib/inngest/functions/vacation-balances-grant";

/**
 * Inngest webhook endpoint. The dev runtime (`inngest-cli dev`) and the
 * Inngest Cloud both POST execution requests here; GET/PUT serve as
 * registration probes.
 *
 * Functions are listed inline so dead imports show up at build time. As
 * Fase E grows, each new function gets pushed to this array.
 */
// A scheduled AI task runs the agent's tool loop inside one step.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    issueInvoice,
    agingWeeklySummary,
    notificationsDispatch,
    filesSweepOrphans,
    searchIndexRefresh,
    ttlCleanup,
    vacationBalancesGrant,
    documentExpiryAlerts,
    documentExtraction,
    aiAnalyst,
    fleetDocumentExpiryAlerts,
    bcraExchangeRate,
    caeaRequest,
    caeaInform,
    arcaIssuedSync,
    aiWorkflowsMaterialize,
    aiWorkflowRun,
    aiWeeklySummaryFanOut,
    aiWeeklySummary,
  ],
});
