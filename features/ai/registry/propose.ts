import { tool } from "ai";
import { z } from "zod";

import type { Permission } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

import type {
  ProposalIssue,
  ProposalLabels,
  ProposalSummaryRow,
  TypedProposalSpec,
} from "../lib/proposal-specs";
import {
  AiProposalStoreError,
  canRunAiAction,
  toPermissions,
  type AiAction,
  type AiActionContext,
  type AiDomain,
  type AiToolCall,
} from "./define";
import { errResult, type AiToolResult } from "./result";

/** Records the model may offer the user when a name matched more than one. */
export type ProposalCandidate = {
  field: string;
  options: { value: string; label: string }[];
};

/** What `prepare` resolves from the model's input: a draft for the form's
 *  schema, what is still missing or ambiguous, or a failed lookup. */
export type AiPrepareResult =
  | { kind: "draft"; draft: unknown; labels?: ProposalLabels }
  | {
      kind: "issues";
      issues: ProposalIssue[];
      candidates?: ProposalCandidate[];
    }
  | { kind: "error"; error: string };

/** The data a ready proposal hands the card (and the model). */
export type ProposalCardData = {
  requiresConfirmation: true;
  confirmationId: string;
  action: string;
  revisionKey: string;
  revision: number;
  title: string;
  draft: unknown;
  summary: ProposalSummaryRow[];
  confirmLabel: string;
  declineLabel: string;
};

/** The data of a proposal that could not be drafted yet. */
export type ProposalIssuesData = {
  requiresConfirmation: false;
  action: string;
  issues: ProposalIssue[];
  candidates?: ProposalCandidate[];
};

type AiProposalDefinition<I extends z.ZodObject, D extends z.ZodType> = {
  name: string;
  domain: AiDomain;
  description: string;
  /** What the model fills in (names, codes, dates); `prepare` resolves it. */
  input: I;
  /** The same permissions the manual form's server action checks, plus the
   *  reads `prepare` needs. Required to expose, to propose and to confirm. */
  permission: Permission | readonly Permission[];
  sources: readonly string[];
  spec: TypedProposalSpec<D>;
  prepare: (
    ctx: AiActionContext,
    input: z.output<I>,
  ) => Promise<AiPrepareResult>;
  /** The write, as `ctx.userId`, with a draft parsed by `spec.draft`. */
  execute: (
    ctx: AiActionContext,
    draft: z.output<D>,
  ) => Promise<ActionResult<{ id: string }>>;
};

const revisionKeySchema = z.object({
  revisionKey: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional()
    .describe(
      "Pass the revisionKey of an earlier proposal to replace it with this one " +
        "(e.g. the user asked to change a date). Omit for a new proposal.",
    ),
});

/**
 * A `propose` action: resolves the model's input into a draft, holds it to
 * the manual form's schema, and parks it as a pending confirmation. It never
 * writes business data; the user's Confirm runs `proposal.executeDraft`
 * (features/ai/actions/confirmation-actions.ts).
 */
export function defineAiProposal<I extends z.ZodObject, D extends z.ZodType>(
  def: AiProposalDefinition<I, D>,
): AiAction {
  const permissions = toPermissions(def.permission);
  const { spec } = def;

  function result(
    summary: string,
    data: ProposalCardData | ProposalIssuesData,
  ): AiToolResult {
    return {
      ok: true,
      summary,
      data,
      meta: {
        sources: def.sources,
        asOf: new Date().toISOString(),
        partial: false,
      },
    };
  }

  function issuesResult(
    issues: ProposalIssue[],
    candidates?: ProposalCandidate[],
  ): AiToolResult {
    return result(
      "No proposal yet: " +
        issues.map((i) => `${i.field}: ${i.message}`).join("; ") +
        ". Ask the user (askQuestions, offering the candidates) instead of guessing.",
      {
        requiresConfirmation: false,
        action: def.name,
        issues,
        ...(candidates?.length ? { candidates } : {}),
      },
    );
  }

  async function execute(
    ctx: AiActionContext,
    raw: unknown,
    call?: AiToolCall,
  ): Promise<AiToolResult> {
    if (!canRunAiAction(ctx.access, permissions)) {
      return errResult("No tenés permiso para esta acción.");
    }
    if (!ctx.proposals || !call) {
      return errResult("Las propuestas solo se pueden hacer desde el chat.");
    }
    const parsed = def.input.safeParse(raw);
    const key = revisionKeySchema.safeParse(raw);
    if (!parsed.success || !key.success) {
      const issue = (parsed.error ?? key.error)?.issues[0];
      return errResult(issue?.message ?? "Parámetros inválidos.");
    }

    let prepared: AiPrepareResult;
    try {
      prepared = await def.prepare(ctx, parsed.data);
    } catch (error) {
      logger.error("ai.proposal.prepare_failed", {
        action: def.name,
        userId: ctx.userId,
        error,
      });
      return errResult("No se pudo armar la propuesta.");
    }
    if (prepared.kind === "error") return errResult(prepared.error);
    if (prepared.kind === "issues") {
      return issuesResult(prepared.issues, prepared.candidates);
    }

    const labels = prepared.labels ?? {};
    const validated = spec.validate(prepared.draft, labels);
    if (!validated.ok) return issuesResult(validated.issues);

    const revisionKey = key.data.revisionKey ?? crypto.randomUUID();
    let stored: { id: string; revision: number };
    try {
      stored = await ctx.proposals.createRevision({
        toolCallId: call.toolCallId,
        action: def.name,
        revisionKey,
        draft: validated.draft,
        labels,
        summary: validated.summary,
      });
    } catch (error) {
      if (error instanceof AiProposalStoreError)
        return errResult(error.message);
      logger.error("ai.proposal.store_failed", {
        action: def.name,
        userId: ctx.userId,
        error,
      });
      return errResult("No se pudo guardar la propuesta.");
    }

    return result(
      `Proposal ready (revision ${stored.revision}, revisionKey ${revisionKey}). ` +
        "It is waiting for the user's Confirm on the card: nothing has been written. " +
        "Do not say it was done; end the turn with one short line.",
      {
        requiresConfirmation: true,
        confirmationId: stored.id,
        action: def.name,
        revisionKey,
        revision: stored.revision,
        title: spec.title,
        draft: validated.draft,
        summary: validated.summary,
        confirmLabel: spec.confirmLabel,
        declineLabel: spec.declineLabel,
      },
    );
  }

  const inputSchema: z.ZodType = def.input.extend(revisionKeySchema.shape);

  return {
    name: def.name,
    domain: def.domain,
    description: def.description,
    permissions,
    sideEffect: "propose",
    sources: def.sources,
    execute,
    toTool: (ctx) =>
      tool({
        description: def.description,
        inputSchema,
        execute: (input, { toolCallId }) => execute(ctx, input, { toolCallId }),
      }),
    proposal: {
      spec,
      executeDraft: async (ctx, draft) => {
        const parsed = spec.draft.safeParse(draft);
        if (!parsed.success) {
          return {
            ok: false,
            error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
          };
        }
        return def.execute(ctx, parsed.data);
      },
    },
  };
}
