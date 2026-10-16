import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";

import { streamChat } from "@/features/ai/agent";
import { createArtifactSink } from "@/features/ai/artifacts/sink";
import { parseIncomingUserMessage } from "@/features/ai/lib/chat-message";
import {
  AI_DAILY_TOKEN_CAP,
  appendAiMessage,
  ensureAiSession,
  getAiUsageToday,
  loadAiSessionMessages,
  maybeTitleAiSession,
  messageText,
  recordAiUsage,
  saveAnsweredQuestionCard,
  type AiUsageToday,
} from "@/features/ai/lib/chat-store";
import {
  chatProposalStore,
  listSessionConfirmations,
  proposalStatusNote,
} from "@/features/ai/lib/confirmations";
import {
  answersTurnMessage,
  applyQuestionAnswers,
} from "@/features/ai/lib/questions";
import { buildAiTools, buildCapabilitiesSummary } from "@/features/ai/registry";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { RateLimitError, enforceRateLimit } from "@/lib/rate-limit";

// In-process streaming (single Next.js app — no Redis/relay). The agent tool
// loop can run several model turns, so allow up to 5 minutes.
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) {
    return NextResponse.json(
      { error: "Sin permiso para usar el chat de IA." },
      { status: 403 },
    );
  }

  // Turn caps (Postgres-backed, fail-closed). The 500K-tokens/day cap arrives
  // in AI.6 with the ai_usage table + RPC; here we bound turns/user to stop
  // runaway spend from the first chat.
  try {
    await enforceRateLimit({
      userId: ctx.userId,
      key: "ai:chat:hourly",
      max: 30,
      windowMs: 60 * 60 * 1000,
    });
    await enforceRateLimit({
      userId: ctx.userId,
      key: "ai:chat:daily",
      max: 300,
      windowMs: 24 * 60 * 60 * 1000,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: "Alcanzaste el límite de consultas de IA. Probá más tarde." },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }
    throw err;
  }

  // Daily token cap (global, fail-closed). Approximate: the current turn isn't
  // counted yet, but maxSteps bounds the overshoot. If the usage RPC errors we
  // block rather than let spend run unbounded.
  let usageToday: AiUsageToday;
  try {
    usageToday = await getAiUsageToday();
  } catch {
    return NextResponse.json(
      { error: "No se pudo verificar el límite de IA. Probá de nuevo." },
      { status: 503 },
    );
  }
  if (usageToday.totalTokens >= AI_DAILY_TOKEN_CAP) {
    return NextResponse.json(
      { error: "Se alcanzó el límite diario de IA. Probá de nuevo mañana." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const field = (key: string): unknown =>
    typeof body === "object" && body !== null && key in body
      ? Reflect.get(body, key)
      : undefined;
  const sessionId = field("sessionId");
  if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  // A turn is either a plain user text message, or the answers to the
  // question card the transcript ends on (they become that tool call's
  // output). The message is persisted and replayed into the model: no
  // assistant/system role, no forged tool results.
  const rawAnswers = field("questionAnswers");
  const answers =
    typeof rawAnswers === "object" && rawAnswers !== null
      ? {
          toolCallId: Reflect.get(rawAnswers, "toolCallId"),
          answers: Reflect.get(rawAnswers, "answers"),
        }
      : null;
  const message = answers
    ? null
    : await parseIncomingUserMessage(field("message"));
  if (!answers && !message) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  // Create-or-verify the session (id is client-supplied), then persist the
  // incoming user message before streaming so it survives a mid-stream drop.
  try {
    await ensureAiSession(ctx.userId, sessionId);
  } catch (err) {
    if (err instanceof Error && err.message === "forbidden_session") {
      return NextResponse.json(
        { error: "Esta conversación no es tuya." },
        { status: 403 },
      );
    }
    throw err;
  }

  const prior = await loadAiSessionMessages(ctx.userId, sessionId);
  const isFirstTurn = prior.length === 0;
  let allMessages: UIMessage[];
  if (answers) {
    if (typeof answers.toolCallId !== "string") {
      return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    }
    const applied = applyQuestionAnswers(
      prior,
      answers.toolCallId,
      answers.answers,
    );
    const answered = applied.ok ? applied.messages.at(-1) : undefined;
    if (!applied.ok || !answered) {
      return NextResponse.json(
        { error: applied.ok ? "No hay preguntas pendientes." : applied.error },
        { status: 409 },
      );
    }
    // Compare-and-set on the stored card: a second submission (double click,
    // two tabs) gets 409 instead of starting a second run.
    if (
      !(await saveAnsweredQuestionCard(sessionId, answered, applied.partIndex))
    ) {
      return NextResponse.json(
        { error: "No hay preguntas pendientes." },
        { status: 409 },
      );
    }
    // The model answers in a new turn: replaying the card's assistant message
    // as an unfinished turn would need its thinking blocks back unchanged.
    const turn = answersTurnMessage(answers.toolCallId);
    await appendAiMessage(sessionId, turn);
    allMessages = [...applied.messages, turn];
  } else if (message) {
    await appendAiMessage(sessionId, message);
    allMessages = [...prior, message];
  } else {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  // What the user decided on earlier proposal cards, from the database: the
  // transcript's tool results never change after the fact.
  let proposalNote = "";
  try {
    proposalNote = proposalStatusNote(
      await listSessionConfirmations(ctx.userId, sessionId),
    );
  } catch (err) {
    logger.error("ai.chat.proposals.load_failed", {
      userId: ctx.userId,
      sessionId,
      error: err,
    });
  }

  // Only the actions this user's roles may run become tools: the model never
  // sees (or can call) the rest, and each tool re-checks the permission.
  // Proposals park their drafts in this session for the user to confirm;
  // charts and tables stream to the response as `data-artifact` parts.
  const artifacts = createArtifactSink();
  const tools = buildAiTools({
    userId: ctx.userId,
    roles: ctx.roles,
    proposals: chatProposalStore(ctx.userId, sessionId),
    artifacts,
  });
  const result = await streamChat(allMessages, {
    tools,
    capabilities: buildCapabilitiesSummary(ctx.roles, undefined, {
      artifacts: true,
    }),
    notes: proposalNote,
    userId: ctx.userId,
    sessionId,
    onUsage: (usage) =>
      recordAiUsage({
        kind: "chat",
        sessionId,
        userId: ctx.userId,
        ...usage,
      }),
  });

  const stream = createUIMessageStream({
    originalMessages: allMessages,
    // The last original message is the user turn, so the SDK won't auto-assign
    // an id to the assistant response — give it one so persisted messages have
    // stable ids on resume.
    generateId: () => crypto.randomUUID(),
    execute: ({ writer }) => {
      artifacts.attach((chunk) => writer.write(chunk));
      writer.merge(toUIMessageStream({ stream: result.stream, tools }));
    },
    onEnd: async ({ responseMessage }) => {
      try {
        await appendAiMessage(sessionId, responseMessage);
        if (isFirstTurn && message) {
          await maybeTitleAiSession(
            ctx.userId,
            sessionId,
            messageText(message),
          );
        }
      } catch (err) {
        logger.error("ai.chat.persist.failed", {
          userId: ctx.userId,
          sessionId,
          error: err,
        });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}
