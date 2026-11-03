import { z } from "zod";

/** Lifecycle of a proposal made outside the chat (ai_proposals.status). Only
 *  `pending` moves, and only once: to accepted (before it expires),
 *  dismissed or expired; an accepted one whose write then fails ends as
 *  `failed`. guard_ai_proposal refuses every other transition. */
export const AI_PROPOSAL_STATUSES = [
  "pending",
  "accepted",
  "dismissed",
  "failed",
  "expired",
] as const;

export type AiProposalStatus = (typeof AI_PROPOSAL_STATUSES)[number];

/** How long a prepared proposal stays acceptable: the figures it shows were
 *  read when it was prepared. */
export const AI_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

export const AI_PROPOSAL_COLUMNS =
  "id, action, source, insight_id, insight_kind, dedupe_key, draft, labels, summary, title, status, result, error, expires_at, created_at, decided_at";

const summaryRowsSchema = z.array(
  z.object({ label: z.string(), value: z.string() }),
);

/** What an accepted proposal produced (ai_proposals.result). */
export const aiProposalResultSchema = z.object({
  id: z.string(),
  note: z.string().optional(),
});

/** A row as read back from the database (jsonb columns are untrusted). */
export const aiProposalRowSchema = z.object({
  id: z.string(),
  action: z.string(),
  source: z.enum(["insight"]),
  insight_id: z.string().nullable(),
  insight_kind: z.string().nullable(),
  dedupe_key: z.string(),
  draft: z.unknown(),
  labels: z.record(z.string(), z.string()),
  summary: summaryRowsSchema,
  title: z.string(),
  status: z.enum(AI_PROPOSAL_STATUSES),
  result: aiProposalResultSchema.nullable(),
  error: z.string().nullable(),
  expires_at: z.string(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
});

export type AiProposalRow = z.infer<typeof aiProposalRowSchema>;

/** What the insight card's dialog shows. */
export type AiProposalCard = {
  id: string;
  action: string;
  title: string;
  summary: { label: string; value: string }[];
  status: AiProposalStatus;
  expiresAt: string;
  error: string | null;
  note: string | null;
};

export function toProposalCard(row: AiProposalRow): AiProposalCard {
  return {
    id: row.id,
    action: row.action,
    title: row.title,
    summary: row.summary,
    status: row.status,
    expiresAt: row.expires_at,
    error: row.error,
    note: row.result?.note ?? null,
  };
}

/** The proposal an insight offers (ai_insights.proposal), as the analyst
 *  writes it: a registry `propose` action, the button's label and the
 *  action's input. */
export const InsightProposalSchema = z.object({
  action: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  input: z.record(z.string(), z.unknown()),
});

export type InsightProposal = z.infer<typeof InsightProposalSchema>;
