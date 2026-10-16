import {
  getEmailFrom,
  getEmailReplyTo,
  getResendClient,
  isEmailConfigured,
} from "@/lib/email/client";
import {
  AGING_VIEW_AMOUNT_COLUMNS,
  aggregateClientAging,
  formatCurrencyAmounts,
  type AgingReport,
  type CurrencyAmounts,
} from "@/lib/aging";
import { formatArgentineDate, formatMoney } from "@/lib/format";
import { fetchLatestUsdRate } from "@/lib/fx";
import { logger } from "@/lib/logger";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Weekly aging summary cron. Logs a structured payload finance can grep, and
// emails it to FINANCE_EMAIL via Resend when email is configured (dev without
// RESEND_API_KEY/EMAIL_FROM/FINANCE_EMAIL just logs and skips the send).

type AgingSummary = {
  totals: AgingReport["totals"];
  usd_rate: AgingReport["usd_rate"];
  top: Array<{
    legal_name: string;
    cuit: string;
    total: CurrencyAmounts;
    bucket_90_plus: CurrencyAmounts;
    oldest_days: number;
  }>;
};

const TD = "padding:4px 8px;border-bottom:1px solid #eee";

function renderAgingEmail(
  summary: AgingSummary,
  generatedAt: string,
): { subject: string; html: string } {
  const { totals, top, usd_rate } = summary;
  const date = generatedAt.slice(0, 10);
  const rows = top
    .map(
      (c) => `<tr>
        <td style="${TD}">${c.legal_name}</td>
        <td style="${TD};text-align:right">${formatCurrencyAmounts(c.total)}</td>
        <td style="${TD};text-align:right">${formatCurrencyAmounts(c.bucket_90_plus)}</td>
        <td style="${TD};text-align:right">${c.oldest_days} d</td>
      </tr>`,
    )
    .join("");
  const equivalent =
    totals.total.usd === 0
      ? ""
      : totals.total_ars_equivalent !== null && usd_rate
        ? `<li>Equivalente en pesos: ${formatMoney(totals.total_ars_equivalent)} (dólar oficial ${formatMoney(usd_rate.rate)} del ${formatArgentineDate(usd_rate.rate_date)})</li>`
        : "<li>Sin cotización del dólar cargada: el saldo en USD no se consolida en pesos.</li>";
  const b = totals.buckets;
  return {
    subject: `Aging semanal — ${date} · ${formatCurrencyAmounts(totals.total)} abierto`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:640px">
      <h2>Aging semanal — ${date}</h2>
      <p>${totals.party_count} clientes con deuda · ${totals.document_count} comprobantes abiertos.</p>
      <ul>
        <li>0–30: ${formatCurrencyAmounts(b["0_30"])}</li>
        <li>30–60: ${formatCurrencyAmounts(b["30_60"])}</li>
        <li>60–90: ${formatCurrencyAmounts(b["60_90"])}</li>
        <li>+90: ${formatCurrencyAmounts(b["90_plus"])}</li>
        <li><strong>Total abierto: ${formatCurrencyAmounts(totals.total)}</strong></li>
        ${equivalent}
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
    const summary = await step.run(
      "compose-summary",
      async (): Promise<AgingSummary> => {
        const supabase = getServiceClient();
        const [{ data, error }, usdRate] = await Promise.all([
          paginateRange((from, to) =>
            supabase
              .from("v_client_aging")
              .select(
                `client_id, ${AGING_VIEW_AMOUNT_COLUMNS}, clients!inner(legal_name, display_name, cuit)`,
              )
              .order("client_id", { ascending: true })
              .range(from, to),
          ),
          fetchLatestUsdRate(supabase),
        ]);
        if (error) throw new Error(`compose-summary: ${error.message}`);

        const report = aggregateClientAging(data, usdRate);
        return {
          totals: report.totals,
          usd_rate: report.usd_rate,
          top: report.rows.slice(0, 20).map((r) => ({
            legal_name: r.legal_name,
            cuit: r.cuit,
            total: r.total,
            bucket_90_plus: r.buckets["90_plus"],
            oldest_days: r.oldest_days,
          })),
        };
      },
    );

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
