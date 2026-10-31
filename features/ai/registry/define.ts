import { tool, type Tool } from "ai";
import type { z } from "zod";

import { userCan, type Permission, type Access } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

import type { AiArtifactSink } from "../artifacts/sink";
import type { ProposalSpec } from "../lib/proposal-specs";

import { errResult, type AiRunResult, type AiToolResult } from "./result";

export const AI_DOMAINS = [
  "ventas",
  "compras",
  "tesoreria",
  "contabilidad",
  "rrhh",
  "flota",
  "deposito",
  "afip",
  "general",
] as const;

export type AiDomain = (typeof AI_DOMAINS)[number];

/** read: only reads. propose: drafts a change the user must confirm.
 *  execute: performs a confirmed change. */
export type AiSideEffect = "read" | "propose" | "execute";

/** A proposal revision as the store is asked to keep it. */
export type AiProposalRevisionInput = {
  toolCallId: string;
  action: string;
  revisionKey: string;
  draft: unknown;
  labels: Record<string, string>;
  summary: { label: string; value: string }[];
};

/** A store refusal the model may read and act on (its message is Spanish
 *  user-facing copy): a lost race, or a revisionKey of another action. */
export class AiProposalStoreError extends Error {}

/**
 * Where `propose` actions park their drafts until the user decides. Bound to
 * one user and one chat session by whoever builds the context; a newer
 * revision with the same `revisionKey` supersedes the pending one.
 */
export interface AiProposalStore {
  createRevision(
    input: AiProposalRevisionInput,
  ): Promise<{ id: string; revision: number }>;
}

/** Who the assistant is acting for, from the chat route's session. */
export type AiActionContext = {
  userId: string;
  access: Access;
  /** Present in a chat session; `propose` actions refuse to run without it. */
  proposals?: AiProposalStore;
  /** Present in a chat session; the artifact tools are offered only with it. */
  artifacts?: AiArtifactSink;
};

/** The tool call an execution answers (from the AI SDK). */
export type AiToolCall = { toolCallId: string };

export type AiActionDefinition<S extends z.ZodType> = {
  name: string;
  domain: AiDomain;
  /** Shown to the model as the tool description; first sentence feeds the
   *  capabilities summary. */
  description: string;
  input: S;
  /** Validates `data` on success; a mismatch becomes an error result. */
  output?: z.ZodType;
  /** Every listed permission is required, both to expose and to run;
   *  `{ anyOf }` requires at least one of them instead. */
  permission:
    Permission | readonly Permission[] | { anyOf: readonly Permission[] };
  sideEffect: AiSideEffect;
  /** Tables, views or RPCs the figures come from (result `meta.sources`). */
  sources: readonly string[];
  run: (ctx: AiActionContext, input: z.output<S>) => Promise<AiRunResult>;
};

/** A registered action with its input type erased, so heterogeneous actions
 *  live in one catalogue. */
export type AiAction = {
  readonly name: string;
  readonly domain: AiDomain;
  readonly description: string;
  readonly permissions: readonly Permission[];
  /** When non-empty, at least one of these is also required. */
  readonly anyOfPermissions: readonly Permission[];
  readonly sideEffect: AiSideEffect;
  readonly sources: readonly string[];
  /** The input schema of a `read` action (pinned artifacts store its parse). */
  readonly input?: z.ZodType;
  /** Permission gate → input validation → run → provenance. Never throws. */
  execute: (
    ctx: AiActionContext,
    input: unknown,
    call?: AiToolCall,
  ) => Promise<AiToolResult>;
  /** The AI SDK tool bound to `ctx`. */
  toTool: (ctx: AiActionContext) => Tool;
  /** Set on `propose` actions only. */
  readonly proposal?: AiProposal;
};

/** What a `propose` action adds: its card spec and the executor a confirmed
 *  draft runs through. */
export type AiProposal = {
  readonly spec: ProposalSpec;
  /** Re-parses `draft` with the spec's schema and performs the write as
   *  `ctx.userId`. The caller has already checked the action's permissions. */
  executeDraft: (
    ctx: AiActionContext,
    draft: unknown,
  ) => Promise<ActionResult<{ id: string }>>;
};

export type AiActionGate = Pick<AiAction, "permissions" | "anyOfPermissions">;

export function canRunAiAction(access: Access, gate: AiActionGate): boolean {
  return (
    gate.permissions.every((p) => userCan(access, p)) &&
    (gate.anyOfPermissions.length === 0 ||
      gate.anyOfPermissions.some((p) => userCan(access, p)))
  );
}

export function toPermissions(
  permission: AiActionDefinition<z.ZodType>["permission"],
): AiActionGate {
  if (typeof permission === "string") {
    return { permissions: [permission], anyOfPermissions: [] };
  }
  if ("anyOf" in permission) {
    return { permissions: [], anyOfPermissions: permission.anyOf };
  }
  return { permissions: permission, anyOfPermissions: [] };
}

export function defineAiAction<S extends z.ZodType>(
  def: AiActionDefinition<S>,
): AiAction {
  const gate = toPermissions(def.permission);

  async function execute(
    ctx: AiActionContext,
    input: unknown,
  ): Promise<AiToolResult> {
    if (!canRunAiAction(ctx.access, gate)) {
      return errResult("No tenés permiso para esta consulta.");
    }
    const parsed = def.input.safeParse(input);
    if (!parsed.success) {
      return errResult(
        parsed.error.issues[0]?.message ?? "Parámetros inválidos.",
      );
    }
    let res: AiRunResult;
    try {
      res = await def.run(ctx, parsed.data);
    } catch (error) {
      logger.error("ai.action.failed", {
        action: def.name,
        userId: ctx.userId,
        error,
      });
      return errResult("La consulta falló.");
    }
    if (!res.ok) return res;
    if (def.output && !def.output.safeParse(res.data).success) {
      logger.error("ai.action.output_mismatch", {
        action: def.name,
        userId: ctx.userId,
      });
      return errResult("La consulta devolvió datos con un formato inesperado.");
    }
    const { partial, currency, exchangeRate, note, ...rest } = res;
    return {
      ...rest,
      meta: {
        sources: def.sources,
        asOf: new Date().toISOString(),
        partial: partial ?? false,
        ...(currency ? { currency } : {}),
        ...(exchangeRate ? { exchangeRate } : {}),
        ...(note ? { note } : {}),
      },
    };
  }

  return {
    name: def.name,
    domain: def.domain,
    description: def.description,
    ...gate,
    sideEffect: def.sideEffect,
    sources: def.sources,
    input: def.input,
    execute,
    toTool: (ctx) =>
      tool({
        description: def.description,
        inputSchema: def.input,
        execute: (input) => execute(ctx, input),
      }),
  };
}
