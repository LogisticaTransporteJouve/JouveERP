import type { UIMessage } from "ai";
import { NextResponse } from "next/server";

import { streamChat } from "@/features/ai/agent";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { RateLimitError, enforceRateLimit } from "@/lib/rate-limit";

// In-process streaming (single Next.js app — no Redis/relay). The agent tool
// loop can run several model turns, so allow up to 5 minutes.
export const maxDuration = 300;

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

  const body: { messages?: UIMessage[] } = await req.json();
  const result = await streamChat(body.messages ?? []);
  return result.toUIMessageStreamResponse();
}
