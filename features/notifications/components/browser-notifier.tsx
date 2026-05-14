"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

// Cuando llega un INSERT en notifications via realtime, dispara una
// Notification nativa del browser SI:
//   - el user habilitó permisos
//   - el tab no está en foco (visibilityState !== 'visible')
//
// No pide permiso automáticamente — eso lo gatilla el NotificationBell
// la primera vez que se abre. Sin service worker (no push, no
// background): solo aparece mientras la app está abierta en alguna
// pestaña.

type Payload = {
  id: string;
  recipient_id: string;
  type: string;
  metadata: { channel_id?: string; preview?: string } | null;
  sender_id: string | null;
};

type Props = {
  currentUserId: string;
};

const TITLE_BY_TYPE: Record<string, string> = {
  chat_message: "Mensaje nuevo",
  chat_reply: "Te respondieron",
  chat_mention: "Te mencionaron",
};

export function BrowserNotifier({ currentUserId }: Props) {
  const lastFiredRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;

    const supabase = createClient();
    const channel = supabase.channel(`browser-notif:${currentUserId}`);

    channel.on(
      "postgres_changes" as never,
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `recipient_id=eq.${currentUserId}`,
      },
      (raw: { new: Payload }) => {
        const payload = raw.new;
        if (!payload || lastFiredRef.current === payload.id) return;
        lastFiredRef.current = payload.id;

        if (Notification.permission !== "granted") return;
        if (document.visibilityState === "visible") return;

        const title = TITLE_BY_TYPE[payload.type] ?? "Notificación";
        const body = payload.metadata?.preview ?? "";
        const tag = `notif:${payload.id}`;

        try {
          const notif = new Notification(title, {
            body,
            tag,
            icon: "/jouve-logo.jpeg",
            silent: false,
          });
          notif.onclick = () => {
            window.focus();
            const channelId = payload.metadata?.channel_id;
            if (channelId) {
              window.location.href = `/chat/${channelId}`;
            }
            notif.close();
          };
        } catch {
          // Algunos browsers móviles tiran si llamás new Notification()
          // sin service worker. Lo silenciamos — el bell in-app cubre.
        }
      },
    );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  return null;
}
