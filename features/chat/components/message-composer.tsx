"use client";

import { CornerDownRight, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { getDisplayName } from "@/lib/avatars";
import { cn } from "@/lib/utils";

import { useSendMessage } from "../hooks/use-chat";
import { useTypingPublisher } from "../hooks/use-typing";
import {
  applyMention,
  filterMembersByQuery,
  findMentionAtCursor,
  type MentionCursor,
} from "../lib/mention";
import type { ChannelMember, Message } from "../types";

type Props = {
  channelId: string;
  replyTo: Message | null;
  onClearReply: () => void;
  placeholder?: string;
  me: { userId: string; displayName: string };
  members: ChannelMember[];
};

export function MessageComposer({
  channelId,
  replyTo,
  onClearReply,
  placeholder,
  me,
  members,
}: Props) {
  const [body, setBody] = useState("");
  const [mentionedIds, setMentionedIds] = useState<Set<string>>(new Set());
  const [mentionCursor, setMentionCursor] = useState<MentionCursor | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const send = useSendMessage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const publishTyping = useTypingPublisher(channelId, me);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [channelId, replyTo]);

  const mentionCandidates = mentionCursor
    ? filterMembersByQuery(members, mentionCursor.query, me.userId)
    : [];
  const mentionOpen = mentionCursor !== null && mentionCandidates.length > 0;

  const updateMentionState = (nextBody: string, cursorPos: number) => {
    setBody(nextBody);
    const cursor = findMentionAtCursor(nextBody, cursorPos);
    setMentionCursor(cursor);
    if (cursor) setMentionIndex(0);
  };

  const pickMention = (member: ChannelMember) => {
    if (!mentionCursor) return;
    const { body: nextBody, cursorPos } = applyMention(body, mentionCursor, member);
    setBody(nextBody);
    setMentionedIds((prev) => new Set(prev).add(member.user_id));
    setMentionCursor(null);
    // Mover el caret donde quedó después del mention.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(cursorPos, cursorPos);
      }
    });
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    // Solo mandar IDs que sigan apareciendo en el body (el user pudo
    // haber borrado el @Mention manualmente).
    const finalMentions = Array.from(mentionedIds).filter((id) => {
      const m = members.find((x) => x.user_id === id);
      if (!m) return false;
      const display = getDisplayName(m.first_name, m.last_name, m.email);
      return body.includes(`@${display}`);
    });
    try {
      await send.mutateAsync({
        channelId,
        body: trimmed,
        replyToId: replyTo?.id ?? null,
        mentionUserIds: finalMentions,
      });
      setBody("");
      setMentionedIds(new Set());
      setMentionCursor(null);
      onClearReply();
      textareaRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al enviar.");
    }
  };

  return (
    <div className="relative border-t bg-background">
      {replyTo ? (
        <div className="flex items-start gap-2 border-b bg-muted/30 px-4 py-2">
          <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              Respondiendo a{" "}
              {getDisplayName(
                replyTo.sender_first_name,
                replyTo.sender_last_name,
                replyTo.sender_email,
              )}
            </p>
            <p className="line-clamp-1 break-words text-xs text-muted-foreground">
              {replyTo.deleted_at ? "Mensaje eliminado" : replyTo.body}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={onClearReply}
            aria-label="Cancelar reply"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : null}

      {mentionOpen ? (
        <div className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-md border bg-popover shadow-md">
          <ul className="max-h-56 overflow-y-auto">
            {mentionCandidates.map((m, idx) => (
              <li key={m.user_id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm",
                    idx === mentionIndex
                      ? "bg-accent"
                      : "hover:bg-accent/50",
                  )}
                  onMouseEnter={() => setMentionIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(m);
                  }}
                >
                  <UserAvatar
                    firstName={m.first_name}
                    lastName={m.last_name}
                    email={m.email}
                    avatarUrl={m.avatar_url}
                    color={m.avatar_color}
                    size="xs"
                  />
                  <span className="truncate">
                    {getDisplayName(m.first_name, m.last_name, m.email)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex-1">
          <Textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              const value = e.target.value;
              const pos = e.target.selectionStart ?? value.length;
              updateMentionState(value, pos);
              if (value.length > 0) publishTyping();
            }}
            onKeyUp={(e) => {
              const target = e.currentTarget;
              updateMentionState(target.value, target.selectionStart ?? 0);
            }}
            onClick={(e) => {
              const target = e.currentTarget;
              updateMentionState(target.value, target.selectionStart ?? 0);
            }}
            placeholder={placeholder ?? "Escribí un mensaje…"}
            maxLength={4000}
            className={cn(
              "min-h-[40px] max-h-32 resize-none border-0 bg-muted/40 text-sm focus-visible:ring-1",
            )}
            onKeyDown={(e) => {
              if (mentionOpen) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIndex((i) => (i + 1) % mentionCandidates.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex(
                    (i) =>
                      (i - 1 + mentionCandidates.length) % mentionCandidates.length,
                  );
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const target = mentionCandidates[mentionIndex];
                  if (target) pickMention(target);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionCursor(null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <Button
          type="button"
          size="icon"
          onClick={submit}
          disabled={send.isPending || body.trim().length === 0}
          aria-label="Enviar"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
