export type NotificationType =
  | "chat_message"
  | "chat_reply"
  | "chat_mention"
  | "document_expiring";

export type Notification = {
  id: string;
  recipient_id: string;
  sender_id: string | null;
  type: NotificationType | string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  sender_first_name: string | null;
  sender_last_name: string | null;
  sender_email: string | null;
  sender_avatar_path: string | null;
  sender_avatar_color: string | null;
  sender_avatar_url: string | null;
};

export function getMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}
