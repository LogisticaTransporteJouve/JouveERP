import { logger } from "@/lib/logger";
import { isPushConfigured, sendPushToUser } from "@/lib/push";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import {
  NOTIFICATIONS_DISPATCH,
  NotificationsDispatchSchema,
} from "../events";

// Takes a notif just created by the chat triggers and distributes
// it to the external channels (push). The inserts into notifications
// happen first — this is only the "caller side" that wakes up the
// devices allowed to receive push.
//
// idempotency: event.data.message_id prevents two invocations for the
// same message from clobbering each other's pushes. If the first failed
// halfway, web-push's internal retries + the helper's cleanup on status
// 410 end up cleaning everything up.

const TITLE_BY_TYPE: Record<string, string> = {
  chat_message: "Mensaje nuevo",
  chat_reply: "Te respondieron",
  chat_mention: "Te mencionaron",
};

export const notificationsDispatch = inngest.createFunction(
  {
    id: "notifications-dispatch",
    name: "Notifications — dispatch push",
    triggers: [{ event: NOTIFICATIONS_DISPATCH }],
    idempotency: "event.data.message_id",
    retries: 2,
  },
  async ({ event, step }) => {
    const { message_id } = NotificationsDispatchSchema.parse(event.data);

    if (!isPushConfigured()) {
      logger.info("notifications.dispatch.skipped", {
        reason: "push_not_configured",
      });
      return { sent: 0, skipped_reason: "push_not_configured" };
    }

    const recipients = await step.run("load-notifications", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from("notifications")
        .select("recipient_id, type, metadata, sender_id")
        .eq("metadata->>message_id", message_id);
      if (error) throw new Error(`load: ${error.message}`);
      return (data ?? []) as Array<{
        recipient_id: string;
        type: string;
        metadata: { preview?: string; channel_id?: string };
        sender_id: string | null;
      }>;
    });

    if (recipients.length === 0) return { sent: 0 };

    // Resolve the sender's display name (just one, shared by all).
    const senderId = recipients[0]!.sender_id;
    const senderName = await step.run("load-sender", async () => {
      if (!senderId) return "Alguien";
      const supabase = getServiceClient();
      const { data } = await supabase
        .from("user_profiles")
        .select("first_name, last_name")
        .eq("user_id", senderId)
        .maybeSingle();
      return (
        `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim()
        || "Alguien"
      );
    });

    let sent = 0;
    for (const notif of recipients) {
      const channelId = notif.metadata?.channel_id;
      const url = channelId ? `/chat/${channelId}` : "/";
      const title = `${senderName} — ${TITLE_BY_TYPE[notif.type] ?? "Notificación"}`;
      const body = notif.metadata?.preview ?? "";

      const ok = await step.run(`send-${notif.recipient_id}`, async () => {
        try {
          await sendPushToUser(notif.recipient_id, {
            title,
            body,
            url,
            tag: `chat:${channelId ?? "none"}`,
          });
          return true;
        } catch (err) {
          logger.warn("notifications.dispatch.user_failed", {
            recipient: notif.recipient_id,
            err: err instanceof Error ? err.message : String(err),
          });
          return false;
        }
      });
      if (ok) sent += 1;
    }

    return { sent, total: recipients.length };
  },
);
