"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

// Typing indicators using Supabase Realtime broadcast — ephemeral, with no
// DB persistence. Each client publishes "typing" events with its
// user_id + display_name; the others hold that state for ~3s and
// render it below the thread.

const TYPING_TIMEOUT_MS = 3000;
const TYPING_THROTTLE_MS = 1500;

export type TypingUser = {
  user_id: string;
  display_name: string;
  expires_at: number;
};

type Payload = {
  user_id: string;
  display_name: string;
};

export function useTypingPublisher(
  channelId: string,
  me: { userId: string; displayName: string },
) {
  const lastSentRef = useRef(0);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`chat-typing:${channelId}`, {
      config: { broadcast: { self: false } },
    });
    channel.subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [channelId]);

  return () => {
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_THROTTLE_MS) return;
    lastSentRef.current = now;
    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: me.userId, display_name: me.displayName } as Payload,
    });
  };
}

export function useTypingListener(
  channelId: string,
  meUserId: string,
): TypingUser[] {
  const [typing, setTyping] = useState<TypingUser[]>([]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`chat-typing:${channelId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on("broadcast", { event: "typing" }, (raw) => {
      const payload = raw.payload as Payload | undefined;
      if (!payload || payload.user_id === meUserId) return;
      setTyping((prev) => {
        const expires = Date.now() + TYPING_TIMEOUT_MS;
        const filtered = prev.filter((u) => u.user_id !== payload.user_id);
        return [
          ...filtered,
          {
            user_id: payload.user_id,
            display_name: payload.display_name,
            expires_at: expires,
          },
        ];
      });
    });

    channel.subscribe();

    // Periodic sweep: clears expired entries so the UI doesn't keep
    // showing "X está escribiendo" forever if the other party closes the
    // tab without sending anything.
    const sweep = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = prev.filter((u) => u.expires_at > now);
        return next.length === prev.length ? prev : next;
      });
    }, 1000);

    return () => {
      clearInterval(sweep);
      supabase.removeChannel(channel);
    };
  }, [channelId, meUserId]);

  return typing;
}
