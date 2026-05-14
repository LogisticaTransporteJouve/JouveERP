import type { Notification } from "../types";
import { getMetadataString } from "../types";

export function getNotificationHref(notif: Notification): string | null {
  const channelId = getMetadataString(notif.metadata, "channel_id");
  if (
    channelId
    && (notif.type === "chat_message"
      || notif.type === "chat_reply"
      || notif.type === "chat_mention")
  ) {
    return `/chat/${channelId}`;
  }
  return null;
}

export function getNotificationTitle(notif: Notification): string {
  switch (notif.type) {
    case "chat_reply":
      return "respondió a tu mensaje";
    case "chat_mention":
      return "te mencionó";
    case "chat_message":
    default:
      return "te mandó un mensaje";
  }
}

export function getNotificationPreview(notif: Notification): string {
  return getMetadataString(notif.metadata, "preview") ?? "";
}

export function formatNotificationTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "ahora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 86_400_000 * 7) return `${Math.floor(diff / 86_400_000)}d`;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}
