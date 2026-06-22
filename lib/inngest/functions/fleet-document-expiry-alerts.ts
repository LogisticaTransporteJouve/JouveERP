import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Daily cron that alerts on fleet documentation expirations (VTV,
// insurance, license, ART, etc.) ≤ 30 days, just like the HR one but reading
// `fleet_documents` (vehicle XOR driver). Reuses the `document_expiring`
// notif type; the metadata carries owner_type + owner_label + ids so
// the UI can provide context. Fans out to owner/admin/operations (fleet perm).

type FleetDocRow = {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  kind: string;
  number: string | null;
  expires_at: string;
  notified_at: string | null;
  vehicle: { patente: string } | null;
  driver: { full_name: string } | null;
};

const NOTIFY_COOLDOWN_DAYS = 7;
const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const fleetDocumentExpiryAlerts = inngest.createFunction(
  {
    id: "fleet-document-expiry-alerts",
    name: "Flota — alerta vencimiento documentos",
    retries: 2,
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 0 8 * * *" }],
  },
  async ({ step }) => {
    const supabase = getServiceClient();

    const docs = await step.run("load-expiring", async () => {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const cutoffStr = new Date(today.getTime() + WINDOW_DAYS * DAY_MS)
        .toISOString()
        .slice(0, 10);
      const { data, error } = await supabase
        .from("fleet_documents")
        .select(
          "id, vehicle_id, driver_id, kind, number, expires_at, notified_at, vehicle:vehicles(patente), driver:drivers(full_name)",
        )
        .gte("expires_at", todayStr)
        .lte("expires_at", cutoffStr)
        .order("expires_at", { ascending: true });
      if (error) throw new Error(`load-expiring: ${error.message}`);
      const cooldown = Date.now() - NOTIFY_COOLDOWN_DAYS * DAY_MS;
      return ((data ?? []) as FleetDocRow[]).filter(
        (d) => !d.notified_at || new Date(d.notified_at).getTime() < cooldown,
      );
    });

    if (docs.length === 0) {
      logger.info("fleet.document_expiry.empty", {});
      return { notified: 0, recipients: 0, docs: 0 };
    }

    const recipientIds = await step.run("load-recipients", async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role_id", ["owner", "admin", "operations"]);
      if (error) throw new Error(`load-recipients: ${error.message}`);
      const ids = new Set<string>();
      for (const r of data ?? []) ids.add(r.user_id);
      return [...ids];
    });

    if (recipientIds.length === 0) {
      logger.warn("fleet.document_expiry.no_recipients", { docs: docs.length });
      return { notified: 0, recipients: 0, docs: docs.length };
    }

    const inserted = await step.run("insert-notifications", async () => {
      const rows = docs.flatMap((d) =>
        recipientIds.map((recipient_id) => ({
          recipient_id,
          sender_id: null,
          type: "document_expiring",
          metadata: {
            owner_type: d.vehicle_id ? "vehicle" : "driver",
            owner_label: d.vehicle?.patente ?? d.driver?.full_name ?? null,
            vehicle_id: d.vehicle_id,
            driver_id: d.driver_id,
            document_id: d.id,
            kind: d.kind,
            number: d.number,
            expires_at: d.expires_at,
            days_until_expiry: Math.round(
              (new Date(d.expires_at).getTime() - Date.now()) / DAY_MS,
            ),
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
        .from("fleet_documents")
        .update({ notified_at: now })
        .in(
          "id",
          docs.map((d) => d.id),
        );
      if (error) throw new Error(`mark-notified: ${error.message}`);
    });

    logger.info("fleet.document_expiry.dispatched", {
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
