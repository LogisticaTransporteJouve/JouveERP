import "server-only";

import webpush, { type PushSubscription } from "web-push";

import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

// Server-side helpers de Web Push. Si las VAPID keys no están en env, el
// send es no-op (logged como skipped). Esto deja que dev/local funcione
// sin la setup completa y que prod la prenda cuando esté listo.

let configured = false;

function configure() {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      && process.env.VAPID_PRIVATE_KEY
      && process.env.VAPID_SUBJECT,
  );
}

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!configure()) return;

  const supabase = getServiceClient();
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .eq("user_id", userId);
  if (error || !subs || subs.length === 0) return;

  const json = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      const subscription: PushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      };
      try {
        await webpush.sendNotification(subscription, json);
      } catch (err) {
        const status =
          err
          && typeof err === "object"
          && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : null;
        // 404 / 410 = endpoint expired or unsubscribed. Limpiamos la fila
        // para no seguir intentando.
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          return;
        }
        logger.warn("push.send_failed", {
          sub_id: sub.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}
