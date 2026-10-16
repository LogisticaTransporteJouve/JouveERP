import type { AttachmentTargetType, HubFilters } from "../schema";

export const filesKeys = {
  all: ["files"] as const,
  attachments: (targetType: AttachmentTargetType, targetId: string) =>
    [...filesKeys.all, "attachments", targetType, targetId] as const,
  hub: (filters: HubFilters) => [...filesKeys.all, "hub", filters] as const,
  hubUploaders: () => [...filesKeys.all, "hubUploaders"] as const,
};
