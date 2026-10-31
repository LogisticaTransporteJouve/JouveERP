"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
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
const ESTIMATED_ROW_HEIGHT = 64;

type Props = {
  channelId: string;
  currentUserId: string;
  currentUserDisplayName: string;
};

type Row =
  | { kind: "day_header"; key: string; iso: string }
  | {
      kind: "message";
      key: string;
      message: Message;
      showAuthor: boolean;
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

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]!;
      const prev = messages[i - 1];
      const showDayHeader =
        !prev || !isSameDay(prev.created_at, message.created_at);
      const showAuthor =
        showDayHeader ||
        !prev ||
        prev.sender_id !== message.sender_id ||
        !withinMinutes(
          prev.created_at,
          message.created_at,
          AUTHOR_GROUP_MINUTES,
        );
      if (showDayHeader) {
        out.push({
          kind: "day_header",
          key: `day-${message.id}`,
          iso: message.created_at,
        });
      }
      out.push({
        kind: "message",
        key: message.id,
        message,
        showAuthor,
      });
    }
    return out;
  }, [messages]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns a mutable instance the React Compiler cannot
  // memoize; skipping compilation of this component is the intended outcome.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 8,
    getItemKey: (i) => rows[i]?.key ?? i,
  });

  // Scroll behavior: new message at the end → scroll down if you were near
  // the bottom. If you're scrolling up, don't interrupt.
  const lastMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const lastId = messages[messages.length - 1]?.id ?? null;
    if (lastId !== lastMessageIdRef.current) {
      const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (fromBottom < 120 || lastMessageIdRef.current === null) {
        virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
      }
      lastMessageIdRef.current = lastId;
    }
  }, [messages, rows.length, virtualizer]);

  // Mark-as-read debounce while the thread is visible.
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
        requestAnimationFrame(() => {
          if (!el) return;
          const diff = el.scrollHeight - prevHeight;
          el.scrollTop = prevTop + diff;
        });
      });
    }
  };

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
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

        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No hay mensajes todavía. Mandá el primero.
            </p>
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.kind === "day_header" ? (
                    <DayHeader iso={row.iso} />
                  ) : (
                    <MessageBubble
                      channelId={channelId}
                      message={row.message}
                      reactions={reactionsByMessage.get(row.message.id) ?? []}
                      currentUserId={currentUserId}
                      showAuthor={row.showAuthor}
                      onReply={setReplyTo}
                    />
                  )}
                </div>
              );
            })}
          </div>
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
