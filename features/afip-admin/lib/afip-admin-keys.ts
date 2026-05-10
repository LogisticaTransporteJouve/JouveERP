/**
 * Query keys for the afip-admin feature.
 */
export const afipAdminKeys = {
  all: ["afip-admin"] as const,
  panel: () => [...afipAdminKeys.all, "panel"] as const,
  channels: () => [...afipAdminKeys.all, "channels"] as const,
};
