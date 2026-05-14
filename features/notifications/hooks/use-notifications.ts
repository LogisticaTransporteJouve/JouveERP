"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  getUnreadCountAction,
  listNotificationsAction,
  markAllReadAction,
  markNotificationReadAction,
} from "../actions/notifications-actions";
import { notificationsKeys } from "../keys";

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationsKeys.unreadCount(),
    queryFn: () => runAction(() => getUnreadCountAction()),
    // Datos chicos, refrescables. staleTime corto.
    staleTime: 5_000,
  });
}

export function useNotifications(
  filter: "all" | "unread",
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: notificationsKeys.list(filter),
    queryFn: () => runAction(() => listNotificationsAction({ filter })),
    enabled: options.enabled,
  });
}

export function useNotificationsRealtime(recipientId: string) {
  useRealtimeInvalidate([
    {
      table: "notifications",
      filter: `recipient_id=eq.${recipientId}`,
      queryKeys: [
        notificationsKeys.unreadCount(),
        notificationsKeys.list("all"),
        notificationsKeys.list("unread"),
      ],
    },
  ]);
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => markNotificationReadAction(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKeys.all });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runAction(() => markAllReadAction()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKeys.all });
    },
  });
}
