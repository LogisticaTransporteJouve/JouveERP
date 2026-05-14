"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

// Typing indicators usando Supabase Realtime broadcast — efímero, sin
// persistencia en BD. Cada cliente publica eventos "typing" con su
// user_id + display_name; los demás guardan ese estado por ~3s y lo
// renderizan abajo del thread.

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

    // Sweep periodico: limpia entries vencidas para que la UI no quede
    // mostrando "X está escribiendo" eternamente si el otro cierra el
    // tab sin mandar nada.
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
