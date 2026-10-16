"use client";

import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runAction } from "@/lib/query/run-action";
import { cn } from "@/lib/utils";

import { getAiSessionMessagesAction } from "../actions/chat-actions";
import { useAiConfirmations } from "../hooks/use-ai-confirmations";
import { aiKeys } from "../lib/ai-keys";
import {
  hasPendingConfirmation,
  proposalToolOutputSchema,
  type AiConfirmation,
} from "../lib/confirmation-schema";
import { artifactSchema } from "../artifacts/spec";
import { activitySteps } from "../lib/activity";
import { AiMarkdown } from "../lib/markdown";
import { isCardPart, segmentParts, type ChatPart } from "../lib/chat-segments";
import {
  ANSWERS_TURN_TEXT,
  ASK_QUESTIONS_TOOL,
  isAnswersTurn,
  pendingQuestionCall,
  type QuestionAnswers,
} from "../lib/questions";

import { ActivityBlock } from "./activity-block";
import { ArtifactCard, PinArtifactButton } from "./artifact-card";
import { ProposalCard } from "./proposal-card";
import { QuestionsCard } from "./questions-card";
import { toolLabel } from "./tool-renderers";

const SUGGESTIONS = [
  "¿Cómo viene la caja?",
  "¿Quién me debe más?",
  "Balance de saldos de este período",
  "IVA ventas del mes",
];

function toolCallIds(messages: UIMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    for (const p of m.parts) if (isToolUIPart(p)) ids.add(p.toolCallId);
  }
  return ids;
}

function readBody(body: object | undefined, key: string): unknown {
  return body && key in body ? Reflect.get(body, key) : undefined;
}

export function AiChat({
  sessionId,
  initialMessages,
  onPersisted,
  atCap = false,
  seedPrompt,
}: {
  sessionId: string;
  initialMessages: UIMessage[];
  onPersisted: (sessionId: string) => void;
  atCap?: boolean;
  seedPrompt?: string;
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        // A turn is the new user message, or the answers to the question
        // card (sent as data; the server sets them as the tool's output).
        prepareSendMessagesRequest: ({ messages, id, body }) => {
          const questionAnswers = readBody(body, "questionAnswers");
          return {
            body: questionAnswers
              ? { sessionId: id, questionAnswers }
              : { sessionId: id, message: messages[messages.length - 1] },
          };
        },
      }),
  );
  // Set while an answers submission is in flight: if the server refuses it
  // (409: the card was already answered elsewhere), the transcript is
  // reloaded from the server instead of keeping the local answers.
  const answering = useRef(false);
  const { messages, setMessages, sendMessage, addToolOutput, status } = useChat(
    {
      id: sessionId,
      messages: initialMessages,
      transport,
      onFinish: () => {
        answering.current = false;
        onPersisted(sessionId);
        void qc.invalidateQueries({
          queryKey: aiKeys.confirmations(sessionId),
        });
      },
      onError: () => {
        if (!answering.current) return;
        answering.current = false;
        toast.info(
          "Esas preguntas ya estaban respondidas. Actualicé la conversación.",
        );
        void runAction(() => getAiSessionMessagesAction(sessionId)).then(
          setMessages,
          () => undefined,
        );
      },
    },
  );
  const { data: confirmations } = useAiConfirmations(sessionId);

  const busy = status === "submitted" || status === "streaming";
  const waitingQuestion = pendingQuestionCall(messages);
  const waitingProposal = confirmations
    ? hasPendingConfirmation(confirmations, toolCallIds(messages))
    : false;
  // Only an unanswered card holds the composer; a pending proposal can still
  // be changed by asking for it.
  const locked = busy || atCap || waitingQuestion !== null;
  const hint = waitingQuestion
    ? "Respondé las preguntas de arriba para seguir."
    : waitingProposal
      ? "Tenés una propuesta pendiente: confirmala, modificala o descartala en la tarjeta, o pedime cambios."
      : null;

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || locked) return;
    setInput("");
    void sendMessage({ text: trimmed });
  }

  async function answer(toolCallId: string, answers: QuestionAnswers) {
    if (busy || atCap) return;
    await addToolOutput({
      tool: ASK_QUESTIONS_TOOL,
      toolCallId,
      output: answers,
    });
    answering.current = true;
    // The server sets the answers as the card's tool output and appends this
    // same fixed turn; the chat hides it (the card shows the answers).
    void sendMessage(
      { text: ANSWERS_TURN_TEXT, metadata: { answersFor: toolCallId } },
      { body: { questionAnswers: { toolCallId, answers } } },
    );
  }

  // Auto-send a seeded prompt once (from an insight's "preguntar sobre esto").
  const seeded = useRef(false);
  useEffect(() => {
    if (seedPrompt && !seeded.current && !atCap) {
      seeded.current = true;
      void sendMessage({ text: seedPrompt });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt]);

  function renderText(m: UIMessage, part: ChatPart, i: number): ReactNode {
    if (part.type !== "text") return null;
    // User input stays plain text; assistant replies are trusted markdown
    // (headings, tables, lists).
    return m.role === "assistant" ? (
      <AiMarkdown key={i} body={part.text} />
    ) : (
      <p key={i} className="whitespace-pre-wrap">
        {part.text}
      </p>
    );
  }

  function renderCard(part: ChatPart, i: number): ReactNode {
    if (!isToolUIPart(part)) return null;
    const name = getToolName(part);
    if (name === ASK_QUESTIONS_TOOL) {
      if (part.state === "input-streaming") return null;
      return (
        <QuestionsCard
          key={part.toolCallId}
          input={part.input}
          output={part.state === "output-available" ? part.output : undefined}
          waiting={part.state === "input-available"}
          disabled={busy || atCap}
          onSubmit={(answers) => void answer(part.toolCallId, answers)}
        />
      );
    }
    if (part.state !== "output-available") {
      return (
        <p
          key={i}
          className="text-muted-foreground flex items-center gap-1 text-xs italic"
        >
          <Sparkles className="size-3" />
          {part.state === "output-error"
            ? `No se pudo armar la ${toolLabel(name).toLowerCase()}.`
            : `armando ${toolLabel(name).toLowerCase()}…`}
        </p>
      );
    }
    return (
      <ProposalPart
        key={part.toolCallId}
        sessionId={sessionId}
        toolCallId={part.toolCallId}
        output={part.output}
        rows={confirmations}
        syncing={busy}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border bg-card p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="text-muted-foreground text-sm">
              Preguntame sobre cobranzas, caja, contabilidad o IVA. Si me pedís
              registrar algo, te armo una propuesta para que la confirmes.
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
          messages
            .filter((m) => !isAnswersTurn(m))
            .map((m, mi, shown) => {
              const steps =
                m.role === "assistant"
                  ? activitySteps(m.parts, isCardPart)
                  : [];
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex flex-col gap-2",
                    m.role === "user" ? "items-end" : "items-start",
                  )}
                >
                  <span className="text-muted-foreground text-xs">
                    {m.role === "user" ? "Vos" : "Asistente"}
                  </span>
                  {steps.length > 0 && (
                    <ActivityBlock
                      steps={steps}
                      live={busy && mi === shown.length - 1}
                    />
                  )}
                  {segmentParts(m.parts).map((seg) =>
                    seg.kind === "card" ? (
                      renderCard(seg.part, seg.index)
                    ) : seg.kind === "artifact" ? (
                      <ArtifactPart key={seg.id} data={seg.data} />
                    ) : (
                      <BubbleSegment
                        key={`b-${seg.parts[0]?.index ?? 0}`}
                        role={m.role}
                      >
                        {seg.parts.map(({ part, index }) =>
                          renderText(m, part, index),
                        )}
                      </BubbleSegment>
                    ),
                  )}
                </div>
              );
            })
        )}
        {status === "submitted" && (
          <p className="text-muted-foreground text-xs italic">Pensando…</p>
        )}
      </div>

      {atCap && (
        <p className="text-muted-foreground text-center text-xs">
          Se alcanzó el límite diario de consultas de IA. Volvé mañana.
        </p>
      )}
      {!atCap && hint && (
        <p className="text-muted-foreground text-center text-xs">{hint}</p>
      )}

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
          placeholder={
            atCap
              ? "Límite diario alcanzado"
              : waitingQuestion
                ? "Esperando tus respuestas en la tarjeta…"
                : "Escribí tu pregunta…"
          }
          disabled={locked}
          autoFocus
          className="h-11 rounded-lg px-4 text-base shadow-none focus-visible:border-input focus-visible:ring-0 focus-visible:outline-none"
        />
        <Button
          type="submit"
          size="icon"
          disabled={locked || !input.trim()}
          className="size-11 shrink-0 rounded-lg"
        >
          <Send className="size-5" />
          <span className="sr-only">Enviar</span>
        </Button>
      </form>
    </div>
  );
}

function BubbleSegment({
  role,
  children,
}: {
  role: UIMessage["role"];
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "max-w-[85%] rounded-lg px-3 py-2 text-sm",
        role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
      )}
    >
      {children}
    </div>
  );
}

function ArtifactPart({ data }: { data: unknown }) {
  const parsed = artifactSchema.safeParse(data);
  if (!parsed.success) {
    return (
      <p className="text-muted-foreground text-xs italic">
        No se pudo mostrar el gráfico o la tabla.
      </p>
    );
  }
  return (
    <ArtifactCard
      artifact={parsed.data}
      control={<PinArtifactButton artifact={parsed.data} />}
    />
  );
}

function ProposalPart({
  sessionId,
  toolCallId,
  output,
  rows,
  syncing,
}: {
  sessionId: string;
  toolCallId: string;
  output: unknown;
  rows: readonly AiConfirmation[] | undefined;
  syncing: boolean;
}) {
  const parsed = proposalToolOutputSchema.safeParse(output);
  if (!parsed.success) {
    return (
      <p className="text-muted-foreground text-xs italic">
        No se pudo armar la propuesta.
      </p>
    );
  }
  const data = parsed.data.data;
  if (!data.requiresConfirmation) {
    return (
      <p className="text-muted-foreground flex items-center gap-1 text-xs italic">
        <Sparkles className="size-3" /> Faltan datos para armar la propuesta.
      </p>
    );
  }
  return (
    <ProposalCard
      sessionId={sessionId}
      toolCallId={toolCallId}
      title={data.title}
      fallbackSummary={data.summary}
      confirmLabel={data.confirmLabel}
      declineLabel={data.declineLabel}
      rows={rows}
      syncing={syncing}
    />
  );
}
