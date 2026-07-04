import type { UIMessage } from "ai";
import { NextResponse } from "next/server";

import { streamChat } from "@/features/ai/agent";
import {
  AI_DAILY_TOKEN_CAP,
  appendAiMessage,
  ensureAiSession,
  getAiUsageToday,
  loadAiSessionMessages,
  logAiUsage,
  maybeTitleAiSession,
  messageText,
  type AiUsageToday,
} from "@/features/ai/lib/chat-store";
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
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } },
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

  const body: { sessionId?: string; message?: UIMessage } = await req.json();
  const { sessionId, message } = body;
  if (!sessionId || !UUID_RE.test(sessionId) || !message) {
    return NextResponse.json(
      { error: "Pedido inválido." },
      { status: 400 },
    );
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
  await appendAiMessage(sessionId, message);

  const allMessages = [...prior, message];
  const result = await streamChat(allMessages, {
    onUsage: (usage) =>
      logAiUsage({
        sessionId,
        userId: ctx.userId,
        ...usage,
      }),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: allMessages,
    // The last original message is the user turn, so the SDK won't auto-assign
    // an id to the assistant response — give it one so persisted messages have
    // stable ids on resume.
    generateMessageId: () => crypto.randomUUID(),
    onFinish: async ({ responseMessage }) => {
      try {
        await appendAiMessage(sessionId, responseMessage);
        if (isFirstTurn) {
          await maybeTitleAiSession(sessionId, messageText(message));
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
}
