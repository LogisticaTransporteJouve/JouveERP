"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { Send, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { ToolArtifact, toolLabel } from "./tool-renderers";

const SUGGESTIONS = [
  "¿Cómo viene la caja?",
  "¿Quién me debe más?",
  "Balance de saldos de este período",
  "IVA ventas del mes",
];

export function AiChat({
  sessionId,
  initialMessages,
  onPersisted,
}: {
  sessionId: string;
  initialMessages: UIMessage[];
  onPersisted: (sessionId: string) => void;
}) {
  const [input, setInput] = useState("");
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        prepareSendMessagesRequest: ({ messages, id }) => ({
          body: { sessionId: id, message: messages[messages.length - 1] },
        }),
      }),
  );
  const { messages, sendMessage, status } = useChat({
    id: sessionId,
    messages: initialMessages,
    transport,
    onFinish: () => onPersisted(sessionId),
  });

  const busy = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    void sendMessage({ text: trimmed });
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border bg-card p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="text-muted-foreground text-sm">
              Preguntame sobre cobranzas, caja, contabilidad o IVA. Solo lectura.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  onClick={() => submit(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-1",
                m.role === "user" ? "items-end" : "items-start",
              )}
            >
              <span className="text-muted-foreground text-xs">
                {m.role === "user" ? "Vos" : "Asistente"}
              </span>
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted",
                )}
              >
                {m.parts.map((part, i) => {
                  if (part.type === "text") {
                    return (
                      <p key={i} className="whitespace-pre-wrap">
                        {part.text}
                      </p>
                    );
                  }
                  if (isToolUIPart(part)) {
                    const name = getToolName(part);
                    if (part.state === "output-available") {
                      return (
                        <ToolArtifact
                          key={i}
                          toolName={name}
                          output={part.output}
                        />
                      );
                    }
                    if (part.state === "output-error") {
                      return (
                        <p
                          key={i}
                          className="text-muted-foreground flex items-center gap-1 text-xs italic"
                        >
                          <Sparkles className="size-3" /> No se pudo consultar{" "}
                          {toolLabel(name)}.
                        </p>
                      );
                    }
                    return (
                      <p
                        key={i}
                        className="text-muted-foreground flex items-center gap-1 text-xs italic"
                      >
                        <Sparkles className="size-3" /> consultando{" "}
                        {toolLabel(name)}…
                      </p>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          ))
        )}
        {status === "submitted" && (
          <p className="text-muted-foreground text-xs italic">Pensando…</p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="flex items-center gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribí tu pregunta…"
          disabled={busy}
          autoFocus
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()}>
          <Send className="size-4" />
          <span className="sr-only">Enviar</span>
        </Button>
      </form>
    </div>
  );
}
