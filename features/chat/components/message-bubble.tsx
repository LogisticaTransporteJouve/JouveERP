"use client";

import {
  CornerDownRight,
  MoreHorizontal,
  Pencil,
  Reply,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { getDisplayName } from "@/lib/avatars";
import { cn } from "@/lib/utils";

import {
  useDeleteMessage,
  useEditMessage,
  useToggleReaction,
} from "../hooks/use-chat";
import { formatMessageTime } from "../lib/format-time";
import { MarkdownBody } from "../lib/markdown";
import type { Message, Reaction } from "../types";

import { ReactionBar } from "./reaction-bar";
import { ReactionPicker } from "./reaction-picker";

type Props = {
  channelId: string;
  message: Message;
  reactions: Reaction[];
  currentUserId: string;
  showAuthor: boolean;
  onReply: (message: Message) => void;
};

export function MessageBubble({
  channelId,
  message,
  reactions,
  currentUserId,
  showAuthor,
  onReply,
}: Props) {
  const isMine = message.sender_id === currentUserId;
  const isDeleted = message.deleted_at !== null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const editMutation = useEditMessage(channelId);
  const deleteMutation = useDeleteMessage(channelId);
  const reactMutation = useToggleReaction(channelId);
  const confirm = useConfirm();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(draft.length, draft.length);
    }
  }, [editing, draft.length]);

  const saveEdit = async () => {
    const next = draft.trim();
    if (!next || next === message.body) {
      setEditing(false);
      return;
    }
    try {
      await editMutation.mutateAsync({ messageId: message.id, body: next });
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al editar.");
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Eliminar este mensaje",
      description: "Se borra para todos los participantes. No se puede deshacer.",
      confirmLabel: "Eliminar",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(message.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar.");
    }
  };

  const react = async (emoji: string) => {
    try {
      await reactMutation.mutateAsync({ messageId: message.id, emoji });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al reaccionar.");
    }
  };

  return (
    <div
      className={cn(
        "group flex gap-3 px-4 py-1 transition-colors hover:bg-accent/30",
        isMine && "flex-row-reverse",
        showAuthor && "pt-3",
      )}
    >
      <div className="flex w-9 shrink-0 justify-center pt-0.5">
        {showAuthor ? (
          <UserAvatar
            firstName={message.sender_first_name}
            lastName={message.sender_last_name}
            email={message.sender_email}
            avatarUrl={message.sender_avatar_url}
            color={message.sender_avatar_color}
            size="sm"
          />
        ) : (
          <span className="hidden text-[10px] text-muted-foreground group-hover:inline">
            {formatMessageTime(message.created_at)}
          </span>
        )}
      </div>

      <div className={cn("min-w-0 flex-1", isMine && "text-right")}>
        {showAuthor ? (
          <div
            className={cn(
              "flex items-baseline gap-2",
              isMine && "justify-end",
            )}
          >
            <span className="text-sm font-medium">
              {getDisplayName(
                message.sender_first_name,
                message.sender_last_name,
                message.sender_email,
              )}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatMessageTime(message.created_at)}
            </span>
          </div>
        ) : null}

        {message.reply_to_message_id ? (
          <ReplyContext message={message} />
        ) : null}

        {isDeleted ? (
          <p className="text-sm italic text-muted-foreground">
            Mensaje eliminado
          </p>
        ) : editing ? (
          <div className="space-y-2 pt-1">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={4000}
              rows={2}
              className="text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                  setDraft(message.body);
                }
              }}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveEdit} disabled={editMutation.isPending}>
                Guardar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(message.body);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="break-words">
            <MarkdownBody body={message.body} />
            {message.edited_at ? (
              <span className="text-[10px] text-muted-foreground">(editado)</span>
            ) : null}
          </div>
        )}

        {!isDeleted ? (
          <ReactionBar
            reactions={reactions}
            currentUserId={currentUserId}
            onToggle={react}
            disabled={reactMutation.isPending}
            align={isMine ? "end" : "start"}
          />
        ) : null}
      </div>

      {!isDeleted && !editing ? (
        <div className="invisible flex shrink-0 items-start gap-1 pt-0.5 group-hover:visible">
          <ReactionPicker onPick={react} disabled={reactMutation.isPending} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Responder"
            onClick={() => onReply(message)}
          >
            <Reply className="size-3.5" />
          </Button>
          {isMine ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Más"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <Pencil className="size-3.5" />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={remove}>
                  <Trash2 className="size-3.5" />
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReplyContext({ message }: { message: Message }) {
  return (
    <div className="mb-1 flex items-start gap-1.5 rounded-md border-l-2 border-muted-foreground/30 bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
      <CornerDownRight className="mt-0.5 size-3 shrink-0" />
      <div className="min-w-0">
        <p className="truncate font-medium">
          {getDisplayName(
            message.reply_to_sender_first_name,
            message.reply_to_sender_last_name,
            message.reply_to_sender_email,
          )}
        </p>
        <p className="line-clamp-2 break-words">
          {message.reply_to_deleted
            ? "Mensaje eliminado"
            : message.reply_to_body ?? "—"}
        </p>
      </div>
    </div>
  );
}
