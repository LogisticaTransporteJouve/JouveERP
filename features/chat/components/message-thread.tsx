"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import {
  useChannelHeader,
  useChannelMessages,
  useChannelMessagesRealtime,
  useChannelReactions,
  useChannelReactionsRealtime,
  useMarkChannelRead,
} from "../hooks/use-chat";
import { formatMessageDay, isSameDay, withinMinutes } from "../lib/format-time";
import type { Message, Reaction } from "../types";

import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { TypingIndicator } from "./typing-indicator";

const AUTHOR_GROUP_MINUTES = 5;
const MARK_READ_DEBOUNCE_MS = 1500;

type Props = {
  channelId: string;
  currentUserId: string;
  currentUserDisplayName: string;
};

export function MessageThread({
  channelId,
  currentUserId,
  currentUserDisplayName,
}: Props) {
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const { messages, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useChannelMessages(channelId);
  const { data: reactionsRaw } = useChannelReactions(channelId);
  const { data: header } = useChannelHeader(channelId);
  useChannelMessagesRealtime(channelId);
  useChannelReactionsRealtime(channelId);

  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of reactionsRaw) {
      const arr = map.get(r.message_id) ?? [];
      arr.push(r);
      map.set(r.message_id, arr);
    }
    return map;
  }, [reactionsRaw]);

  // Refs para mantener scroll cuando llegan mensajes nuevos.
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const lastId = messages[messages.length - 1]?.id ?? null;
    if (lastId !== lastMessageIdRef.current) {
      // Si el user está cerca del bottom (≤120px), scrollear. Si no,
      // dejarlo donde está (puede estar leyendo arriba).
      const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (fromBottom < 120) {
        el.scrollTop = el.scrollHeight;
      }
      lastMessageIdRef.current = lastId;
    }
  }, [messages]);

  // Scroll inicial al bottom solo en el primer mount.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      didInitialScroll.current = true;
    }
  }, []);

  // Mark as read con debounce mientras el thread esté visible.
  const markRead = useMarkChannelRead();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const fire = () => {
      if (document.visibilityState === "visible") {
        markRead.mutate(channelId);
      }
    };
    const t = setTimeout(fire, MARK_READ_DEBOUNCE_MS);
    document.addEventListener("visibilitychange", fire);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", fire);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, messages.length]);

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      const el = scrollRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      const prevTop = el?.scrollTop ?? 0;
      fetchNextPage().then(() => {
        // Mantener posición de scroll después de cargar mensajes viejos.
        requestAnimationFrame(() => {
          if (!el) return;
          const diff = el.scrollHeight - prevHeight;
          el.scrollTop = prevTop + diff;
        });
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No hay mensajes todavía. Mandá el primero.
            </p>
          </div>
        ) : (
          <>
            {hasNextPage ? (
              <div className="flex justify-center py-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Cargando…
                    </>
                  ) : (
                    "Cargar mensajes anteriores"
                  )}
                </Button>
              </div>
            ) : null}

            {messages.map((message, idx) => {
              const prev = messages[idx - 1];
              const showDayHeader =
                !prev || !isSameDay(prev.created_at, message.created_at);
              const showAuthor =
                showDayHeader
                || !prev
                || prev.sender_id !== message.sender_id
                || !withinMinutes(
                  prev.created_at,
                  message.created_at,
                  AUTHOR_GROUP_MINUTES,
                );

              return (
                <div key={message.id}>
                  {showDayHeader ? (
                    <DayHeader iso={message.created_at} />
                  ) : null}
                  <MessageBubble
                    channelId={channelId}
                    message={message}
                    reactions={reactionsByMessage.get(message.id) ?? []}
                    currentUserId={currentUserId}
                    showAuthor={showAuthor}
                    onReply={setReplyTo}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>

      <TypingIndicator channelId={channelId} currentUserId={currentUserId} />

      <MessageComposer
        channelId={channelId}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        me={{ userId: currentUserId, displayName: currentUserDisplayName }}
        members={header.members}
      />
    </div>
  );
}

function DayHeader({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {formatMessageDay(iso)}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
