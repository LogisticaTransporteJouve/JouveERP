"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

// When an INSERT arrives on notifications via realtime, fire a native
// browser Notification IF:
//   - the user enabled permissions
//   - the tab isn't focused (visibilityState !== 'visible')
//
// It doesn't request permission automatically — the NotificationBell
// triggers that the first time it's opened. Without a service worker (no
// push, no background): it only appears while the app is open in some
// tab.

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
          // Some mobile browsers throw if you call new Notification()
          // without a service worker. We swallow it — the in-app bell covers.
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
