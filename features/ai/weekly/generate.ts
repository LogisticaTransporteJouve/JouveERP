import "server-only";

import { generateText } from "ai";

import type { HeadlessUser } from "@/lib/auth/headless-user";
import { listUserIdsWithPermission } from "@/lib/auth/users";
import { getServiceClient } from "@/lib/supabase/service";

import { HEADLESS_WRITER_PROMPT, headlessReadActions } from "../headless";
import { usageTokens, type AiUsageTokens } from "../lib/chat-store";
import { AI_SMALL_MAX_OUTPUT_TOKENS, buildChatModel } from "../model";
import {
  WEEKLY_SUMMARY_RULES,
  buildWeeklyPrompt,
  renderWeeklyFacts,
  weeklyReads,
  type WeeklyReadResult,
} from "./reads";

export const WEEKLY_CONTENT_CHAR_CAP = 8_000;

/** Users who signed in within this window get a weekly summary. */
export const WEEKLY_ACTIVE_DAYS = 30;

export type WeeklySummaryDraft = {
  content: string;
  sources: string[];
  usage: AiUsageTokens;
  model: string;
};

/**
 * Runs the weekly reads the user's roles allow and has the model write the
 * summary over their server-computed figures (no tools: one call). Must run
 * inside `runAsHeadlessUser` so each read keeps its gate and RLS. Null when
 * none of them returned data (no model call then).
 */
export async function generateWeeklySummary(
  user: HeadlessUser,
  weekStart: string,
  now: Date,
): Promise<WeeklySummaryDraft | null> {
  const ctx = { userId: user.userId, access: user.access };
  const visible = new Map(
    headlessReadActions(user.access).map((a) => [a.name, a]),
  );
  const results: WeeklyReadResult[] = [];
  for (const read of weeklyReads(now)) {
    const action = visible.get(read.action);
    if (!action) continue;
    results.push({ read, result: await action.execute(ctx, read.input) });
  }
  if (!results.some((r) => r.result.ok)) return null;

  const { model, servedModel } = buildChatModel();
  const { text, usage } = await generateText({
    model,
    instructions: [
      {
        role: "system",
        content: `${HEADLESS_WRITER_PROMPT}\n\n${WEEKLY_SUMMARY_RULES}`,
      },
    ],
    prompt: buildWeeklyPrompt(weekStart, renderWeeklyFacts(results)),
    maxOutputTokens: AI_SMALL_MAX_OUTPUT_TOKENS,
    providerOptions: { anthropic: { effort: "low" } },
  });
  const content = text.trim().slice(0, WEEKLY_CONTENT_CHAR_CAP);
  if (!content) return null;
  const sources = Array.from(
    new Set(results.flatMap((r) => (r.result.ok ? r.result.meta.sources : []))),
  );
  return {
    content,
    sources,
    usage: usageTokens(usage),
    model: servedModel(),
  };
}

/** Upsert: a retried run replaces the week's summary instead of failing. */
export async function saveWeeklySummary(
  userId: string,
  weekStart: string,
  draft: Pick<WeeklySummaryDraft, "content" | "sources">,
): Promise<void> {
  const { error } = await getServiceClient().from("ai_weekly_summaries").upsert(
    {
      user_id: userId,
      week_start: weekStart,
      content: draft.content,
      sources: draft.sources,
    },
    { onConflict: "user_id,week_start" },
  );
  if (error) throw error;
}

/**
 * Who gets a weekly summary: users whose access holds `ai:chat` (denies
 * included) and who signed in within the last WEEKLY_ACTIVE_DAYS. The
 * per-user run re-checks the account and access before acting.
 */
export async function listWeeklySummaryRecipients(
  now: Date,
): Promise<string[]> {
  const candidates = new Set(await listUserIdsWithPermission("ai:chat"));
  if (candidates.size === 0) return [];

  const service = getServiceClient();
  const { data: users, error: usersError } = await service.auth.admin.listUsers(
    { perPage: 1000 },
  );
  if (usersError) throw usersError;
  const cutoff = now.getTime() - WEEKLY_ACTIVE_DAYS * 24 * 60 * 60 * 1000;
  return users.users
    .filter(
      (u) =>
        candidates.has(u.id) &&
        u.last_sign_in_at !== undefined &&
        u.last_sign_in_at !== null &&
        Date.parse(u.last_sign_in_at) >= cutoff,
    )
    .map((u) => u.id);
}

export type WeeklySummary = {
  weekStart: string;
  content: string;
  createdAt: string;
};

export async function getLatestWeeklySummary(
  userId: string,
): Promise<WeeklySummary | null> {
  const { data, error } = await getServiceClient()
    .from("ai_weekly_summaries")
    .select("week_start, content, created_at")
    .eq("user_id", userId)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        weekStart: data.week_start,
        content: data.content,
        createdAt: data.created_at,
      }
    : null;
}
