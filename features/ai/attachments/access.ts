/** Source tag of chat uploads in public.files. */
export const CHAT_ATTACHMENT_SOURCE = "chat_attachment";

export type ChatAttachmentViewer = { userId: string; isAiAdmin: boolean };

export type ChatAttachmentOwnership = {
  source: string;
  uploadedBy: string | null;
  /** Owner of the session the file is linked to; null while unsent. */
  sessionOwner: string | null;
};

/**
 * Who may open a chat attachment: the session owner, or ai:admin (who can
 * already read every session); an unsent draft only its uploader. Mirrors the
 * `files` / `file_attachments` SELECT policies of migration
 * 20261016150000_files_hub_and_chat_attachments.sql.
 */
export function canViewChatAttachment(
  viewer: ChatAttachmentViewer,
  file: ChatAttachmentOwnership,
): boolean {
  if (file.source !== CHAT_ATTACHMENT_SOURCE) return false;
  if (file.sessionOwner !== null) {
    return file.sessionOwner === viewer.userId || viewer.isAiAdmin;
  }
  return file.uploadedBy === viewer.userId;
}
