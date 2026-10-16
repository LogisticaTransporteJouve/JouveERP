import { z } from "zod";

/** Lifecycle of a proposal revision (ai_chat_confirmations.status). Only
 *  `pending` moves, and only once: to confirmed, declined or superseded;
 *  a confirmed one whose write then fails ends as `failed`. */
export const CONFIRMATION_STATUSES = [
  "pending",
  "confirmed",
  "declined",
  "superseded",
  "failed",
] as const;

export type AiConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export const CONFIRMATION_COLUMNS =
  "id, session_id, tool_call_id, action, revision_key, revision, origin, draft, labels, summary, status, result_id, error, created_at, decided_at";

const summaryRowsSchema = z.array(
  z.object({ label: z.string(), value: z.string() }),
);

/** A row as read back from the database (jsonb columns are untrusted). */
export const confirmationRowSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  tool_call_id: z.string(),
  action: z.string(),
  revision_key: z.string(),
  revision: z.number().int(),
  origin: z.enum(["assistant", "user"]),
  draft: z.unknown(),
  labels: z.record(z.string(), z.string()),
  summary: summaryRowsSchema,
  status: z.enum(CONFIRMATION_STATUSES),
  result_id: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
});

export type AiConfirmation = z.infer<typeof confirmationRowSchema>;

/** The revision a card shows: the latest one made from that card (the
 *  assistant's own, or the user's edits of it). */
export function latestForCard(
  rows: readonly AiConfirmation[],
  toolCallId: string,
): AiConfirmation | undefined {
  let latest: AiConfirmation | undefined;
  for (const row of rows) {
    if (row.tool_call_id !== toolCallId) continue;
    if (!latest || row.revision > latest.revision) latest = row;
  }
  return latest;
}

/** True while a proposal whose card is in the transcript waits for the
 *  user. A pending row with no card (its turn never got persisted) cannot be
 *  decided from the chat, so it must not hold the composer. */
export function hasPendingConfirmation(
  rows: readonly AiConfirmation[],
  cardToolCallIds: ReadonlySet<string>,
): boolean {
  return rows.some(
    (r) => r.status === "pending" && cardToolCallIds.has(r.tool_call_id),
  );
}

/** A `propose` tool's output as the chat transcript holds it. */
export const proposalToolOutputSchema = z.object({
  ok: z.literal(true),
  data: z.discriminatedUnion("requiresConfirmation", [
    z.object({
      requiresConfirmation: z.literal(true),
      confirmationId: z.string(),
      action: z.string(),
      revisionKey: z.string(),
      revision: z.number(),
      title: z.string(),
      draft: z.unknown(),
      summary: summaryRowsSchema,
      confirmLabel: z.string(),
      declineLabel: z.string(),
    }),
    z.object({
      requiresConfirmation: z.literal(false),
      action: z.string(),
      issues: z.array(z.object({ field: z.string(), message: z.string() })),
    }),
  ]),
});

export type ProposalToolOutput = z.infer<typeof proposalToolOutputSchema>;
