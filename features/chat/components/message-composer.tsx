"use client";

import { CornerDownRight, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getDisplayName } from "@/lib/avatars";
import { cn } from "@/lib/utils";

import { useSendMessage } from "../hooks/use-chat";
import type { Message } from "../types";

type Props = {
  channelId: string;
  replyTo: Message | null;
  onClearReply: () => void;
  placeholder?: string;
};

export function MessageComposer({
  channelId,
  replyTo,
  onClearReply,
  placeholder,
}: Props) {
  const [body, setBody] = useState("");
  const send = useSendMessage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto-focus al cambiar de canal o al setear un reply.
    textareaRef.current?.focus();
  }, [channelId, replyTo]);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    try {
      await send.mutateAsync({
        channelId,
        body: trimmed,
        replyToId: replyTo?.id ?? null,
      });
      setBody("");
      onClearReply();
      textareaRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al enviar.");
    }
  };

  return (
    <div className="border-t bg-background">
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

      <div className="flex items-end gap-2 px-3 py-2">
        <div className="flex-1">
          <Textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={placeholder ?? "Escribí un mensaje…"}
            maxLength={4000}
            className={cn(
              "min-h-[40px] max-h-32 resize-none border-0 bg-muted/40 text-sm focus-visible:ring-1",
            )}
            onKeyDown={(e) => {
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
