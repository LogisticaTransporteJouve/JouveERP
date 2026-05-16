import type { AttachmentTargetType } from "../schema";

export const filesKeys = {
  all: ["files"] as const,
  attachments: (targetType: AttachmentTargetType, targetId: string) =>
    [...filesKeys.all, "attachments", targetType, targetId] as const,
};
