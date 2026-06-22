import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Daily cron that inserts in-app notifications when employee documents
// (carnet, libreta, courses, etc.) are about to expire (≤ 30 days).
//
// Strategy:
//   - Reads `v_documents_expiring` (view in migration 20260518100000).
//   - For each doc, fans out to ALL users with role owner/admin/finance
//     (aligned with the hr:* permission in lib/auth/permissions.ts).
//   - Sets `notified_at = now()` to avoid spamming; the filter re-includes
//     a doc if it wasn't alerted in the last 7 days (renewals that
//     re-enter the window).
//
// Notif type: 'document_expiring' (included in notifications_type_known
// by the same migration). Metadata carries employee_id + document_id + kind
// + expires_at + days_until_expiry so the UI can link to
// /employees/{id} and provide context.

type ExpiringDocRow = {
  id: string;
  employee_id: string;
  kind: string;
  number: string | null;
  expires_at: string;
  notified_at: string | null;
  employee_name: string;
  days_until_expiry: number;
};

const NOTIFY_COOLDOWN_DAYS = 7;

export const documentExpiryAlerts = inngest.createFunction(
  {
    id: "document-expiry-alerts",
    name: "HR — alerta vencimiento documentos",
    retries: 2,
    // Daily at 08:00 Buenos Aires.
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 0 8 * * *" }],
  },
  async ({ step }) => {
    const supabase = getServiceClient();

    const docs = await step.run("load-expiring-docs", async () => {
      const { data, error } = await supabase
        .from("v_documents_expiring")
        .select("*")
        .order("days_until_expiry", { ascending: true });
      if (error) throw new Error(`load-expiring-docs: ${error.message}`);
      const cutoff = new Date(
        Date.now() - NOTIFY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
      );
      return ((data ?? []) as ExpiringDocRow[]).filter((d) => {
        if (!d.notified_at) return true;
        return new Date(d.notified_at).getTime() < cutoff.getTime();
      });
    });

    if (docs.length === 0) {
      logger.info("hr.document_expiry_alerts.empty", {
        checked_at: new Date().toISOString(),
      });
      return { notified: 0, recipients: 0, docs: 0 };
    }

    const recipientIds = await step.run("load-recipients", async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role_id", ["owner", "admin", "finance"]);
      if (error) throw new Error(`load-recipients: ${error.message}`);
      const ids = new Set<string>();
      for (const r of data ?? []) ids.add(r.user_id);
      return [...ids];
    });

    if (recipientIds.length === 0) {
      logger.warn("hr.document_expiry_alerts.no_recipients", {
        docs: docs.length,
      });
      return { notified: 0, recipients: 0, docs: docs.length };
    }

    const inserted = await step.run("insert-notifications", async () => {
      const rows = docs.flatMap((d) =>
        recipientIds.map((recipient_id) => ({
          recipient_id,
          sender_id: null,
          type: "document_expiring",
          metadata: {
            employee_id: d.employee_id,
            employee_name: d.employee_name,
            document_id: d.id,
            kind: d.kind,
            number: d.number,
            expires_at: d.expires_at,
            days_until_expiry: d.days_until_expiry,
          },
        })),
      );
      const { error } = await supabase.from("notifications").insert(rows);
      if (error) throw new Error(`insert-notifications: ${error.message}`);
      return rows.length;
    });

    await step.run("mark-notified", async () => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("employee_documents")
        .update({ notified_at: now })
        .in(
          "id",
          docs.map((d) => d.id),
        );
      if (error) throw new Error(`mark-notified: ${error.message}`);
    });

    logger.info("hr.document_expiry_alerts.dispatched", {
      docs: docs.length,
      recipients: recipientIds.length,
      notifications: inserted,
    });

    return {
      notified: inserted,
      recipients: recipientIds.length,
      docs: docs.length,
    };
  },
);
