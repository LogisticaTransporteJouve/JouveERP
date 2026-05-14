export const notificationsKeys = {
  all: ["notifications"] as const,
  list: (filter: "all" | "unread") =>
    [...notificationsKeys.all, "list", filter] as const,
  unreadCount: () => [...notificationsKeys.all, "unread-count"] as const,
};
