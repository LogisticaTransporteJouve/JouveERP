import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { agingSnapshot } from "@/lib/inngest/functions/aging-snapshot";
import { agingWeeklySummary } from "@/lib/inngest/functions/aging-weekly-summary";
import { aiAnalyst } from "@/lib/inngest/functions/ai-analyst";
import {
  aiWeeklySummary,
  aiWeeklySummaryFanOut,
} from "@/lib/inngest/functions/ai-weekly-summary";
import { aiWorkflowRun } from "@/lib/inngest/functions/ai-workflow-run";
import { aiWorkflowScheduler } from "@/lib/inngest/functions/ai-workflow-scheduler";
import { aiWorkflowsReconcile } from "@/lib/inngest/functions/ai-workflows-reconcile";
import { arcaBulkAccept } from "@/lib/inngest/functions/arca-bulk-accept";
import { arcaIssuedSync } from "@/lib/inngest/functions/arca-issued-sync";
import { arcaReceivedSync } from "@/lib/inngest/functions/arca-received-sync";
import { strixKmSync } from "@/lib/inngest/functions/strix-km-sync";
import { auditRetention } from "@/lib/inngest/functions/audit-retention";
import { bcraExchangeRate } from "@/lib/inngest/functions/bcra-exchange-rate";
import { caeaInform } from "@/lib/inngest/functions/caea-inform";
import { caeaRequest } from "@/lib/inngest/functions/caea-request";
import { creditBilledRemito } from "@/lib/inngest/functions/credit-billed-remito";
import { documentExpiryAlerts } from "@/lib/inngest/functions/document-expiry-alerts";
import { documentExtraction } from "@/lib/inngest/functions/document-extraction";
import { fleetDocumentExpiryAlerts } from "@/lib/inngest/functions/fleet-document-expiry-alerts";
import { filesSweepOrphans } from "@/lib/inngest/functions/files-sweep-orphans";
import { issueInvoice } from "@/lib/inngest/functions/issue-invoice";
import { issueInvoiceReconcile } from "@/lib/inngest/functions/issue-invoice-reconcile";
import { notificationsDispatch } from "@/lib/inngest/functions/notifications-dispatch";
import { shipmentsAutoStart } from "@/lib/inngest/functions/shipments-auto-start";
import { tasksDaily } from "@/lib/inngest/functions/tasks-daily";
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
    issueInvoiceReconcile,
    creditBilledRemito,
    agingWeeklySummary,
    agingSnapshot,
    notificationsDispatch,
    filesSweepOrphans,
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
    arcaReceivedSync,
    arcaBulkAccept,
    strixKmSync,
    aiWorkflowScheduler,
    aiWorkflowsReconcile,
    aiWorkflowRun,
    aiWeeklySummaryFanOut,
    aiWeeklySummary,
    tasksDaily,
    shipmentsAutoStart,
    auditRetention,
  ],
});
