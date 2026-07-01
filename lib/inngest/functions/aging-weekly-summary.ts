import {
  getEmailFrom,
  getEmailReplyTo,
  getResendClient,
  isEmailConfigured,
} from "@/lib/email/client";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Weekly aging summary cron. Logs a structured payload finance can grep, and
// emails it to FINANCE_EMAIL via Resend when email is configured (dev without
// RESEND_API_KEY/EMAIL_FROM/FINANCE_EMAIL just logs and skips the send).

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

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

type AgingSummary = {
  totals: {
    bucket_0_30: number;
    bucket_30_60: number;
    bucket_60_90: number;
    bucket_90_plus: number;
    total_open: number;
    client_count: number;
    document_count: number;
  };
  top: Array<{
    legal_name: string;
    cuit: string;
    total_open: number;
    bucket_60_90: number;
    bucket_90_plus: number;
    oldest_days: number;
  }>;
};

function renderAgingEmail(
  summary: AgingSummary,
  generatedAt: string,
): { subject: string; html: string } {
  const { totals, top } = summary;
  const date = generatedAt.slice(0, 10);
  const rows = top
    .map(
      (c) => `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #eee">${c.legal_name}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${ARS.format(c.total_open)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${ARS.format(c.bucket_90_plus)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${c.oldest_days} d</td>
      </tr>`,
    )
    .join("");
  return {
    subject: `Aging semanal — ${date} · ${ARS.format(totals.total_open)} abierto`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:640px">
      <h2>Aging semanal — ${date}</h2>
      <p>${totals.client_count} clientes con deuda · ${totals.document_count} comprobantes abiertos.</p>
      <ul>
        <li>0–30: ${ARS.format(totals.bucket_0_30)}</li>
        <li>30–60: ${ARS.format(totals.bucket_30_60)}</li>
        <li>60–90: ${ARS.format(totals.bucket_60_90)}</li>
        <li>+90: ${ARS.format(totals.bucket_90_plus)}</li>
        <li><strong>Total abierto: ${ARS.format(totals.total_open)}</strong></li>
      </ul>
      <h3>Top deudores</h3>
      <table style="border-collapse:collapse;width:100%">
        <thead><tr>
          <th style="padding:4px 8px;text-align:left">Cliente</th>
          <th style="padding:4px 8px;text-align:right">Total</th>
          <th style="padding:4px 8px;text-align:right">+90</th>
          <th style="padding:4px 8px;text-align:right">Más viejo</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`,
  };
}

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

    const generatedAt = new Date().toISOString();

    await step.run("publish-summary", async () => {
      logger.info("aging.weekly_summary", {
        generated_at: generatedAt,
        ...summary,
      });
    });

    await step.run("email-summary", async () => {
      const to = process.env.FINANCE_EMAIL;
      const resend = getResendClient();
      if (!isEmailConfigured() || !resend || !to) {
        logger.info("aging.weekly_summary.email_skipped", {
          reason: !to ? "no_finance_email" : "email_not_configured",
        });
        return { sent: false };
      }
      const { subject, html } = renderAgingEmail(summary, generatedAt);
      const { data, error } = await resend.emails.send({
        from: getEmailFrom(),
        replyTo: getEmailReplyTo(),
        to,
        subject,
        html,
      });
      if (error) {
        throw new Error(`email-summary: ${error.message}`);
      }
      logger.info("aging.weekly_summary.email_sent", { to, id: data?.id });
      return { sent: true };
    });

    return summary;
  },
);
