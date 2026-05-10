import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Weekly aging summary cron — runs Mondays at 9:00 ART (12:00 UTC).
//
// Reads `v_client_aging` and composes a structured summary of who owes
// what. Today the summary is logged — finance can grep the structured
// log entry. Wiring an actual email send (Resend or SES) goes here as
// the next step: pull `FINANCE_EMAIL` + `RESEND_API_KEY` from env,
// render an HTML table from `clients[]`, POST to Resend's API. We keep
// it as a TODO until a provider is picked so we don't ship half-baked
// email plumbing.

type AgingRow = {
  client_id: string | null;
  bucket_0_30: number | null;
  bucket_30_60: number | null;
  bucket_60_90: number | null;
  bucket_90_plus: number | null;
  total_open: number | null;
  document_count: number | null;
  oldest_days: number | null;
  clients: { legal_name: string; cuit: string } | null;
};

export const agingWeeklySummary = inngest.createFunction(
  {
    id: "aging-weekly-summary",
    name: "Aging — weekly summary",
    retries: 2,
    // Mondays at 09:00 in Buenos Aires (Inngest crons accept TZ= prefix).
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 0 9 * * 1" }],
  },
  async ({ step }) => {
    const summary = await step.run("compose-summary", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from("v_client_aging")
        .select(
          "client_id, bucket_0_30, bucket_30_60, bucket_60_90, bucket_90_plus, total_open, document_count, oldest_days, clients!inner(legal_name, cuit)",
        )
        .order("total_open", { ascending: false })
        .limit(50);
      if (error) throw new Error(`compose-summary: ${error.message}`);

      const rows = (data ?? []) as AgingRow[];
      const totals = {
        bucket_0_30: 0,
        bucket_30_60: 0,
        bucket_60_90: 0,
        bucket_90_plus: 0,
        total_open: 0,
        client_count: 0,
        document_count: 0,
      };
      const top: Array<{
        legal_name: string;
        cuit: string;
        total_open: number;
        bucket_60_90: number;
        bucket_90_plus: number;
        oldest_days: number;
      }> = [];
      for (const row of rows) {
        if (!row.client_id || !row.clients) continue;
        const total = Number(row.total_open ?? 0);
        const b6090 = Number(row.bucket_60_90 ?? 0);
        const b90 = Number(row.bucket_90_plus ?? 0);
        totals.bucket_0_30 += Number(row.bucket_0_30 ?? 0);
        totals.bucket_30_60 += Number(row.bucket_30_60 ?? 0);
        totals.bucket_60_90 += b6090;
        totals.bucket_90_plus += b90;
        totals.total_open += total;
        totals.document_count += Number(row.document_count ?? 0);
        totals.client_count += 1;
        top.push({
          legal_name: row.clients.legal_name,
          cuit: row.clients.cuit,
          total_open: total,
          bucket_60_90: b6090,
          bucket_90_plus: b90,
          oldest_days: Number(row.oldest_days ?? 0),
        });
      }
      return {
        totals,
        top: top.slice(0, 20),
      };
    });

    await step.run("publish-summary", async () => {
      logger.info("aging.weekly_summary", {
        generated_at: new Date().toISOString(),
        ...summary,
      });
      // TODO: when a transactional email provider is configured (Resend
      // or similar), send `summary` to FINANCE_EMAIL here. The shape
      // logged above is what the email body should render.
    });

    return summary;
  },
);
