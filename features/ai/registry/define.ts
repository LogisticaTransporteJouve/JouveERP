import { tool, type Tool } from "ai";
import type { z } from "zod";

import { userCan, type Permission, type Role } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";

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
 *  execute: performs a confirmed change. Phase 1 registers reads only. */
export type AiSideEffect = "read" | "propose" | "execute";

/** Who the assistant is acting for, from the chat route's session. */
export type AiActionContext = {
  userId: string;
  roles: readonly Role[];
};

export type AiActionDefinition<S extends z.ZodType> = {
  name: string;
  domain: AiDomain;
  /** Shown to the model as the tool description; first sentence feeds the
   *  capabilities summary. */
  description: string;
  input: S;
  /** Validates `data` on success; a mismatch becomes an error result. */
  output?: z.ZodType;
  /** Every listed permission is required, both to expose and to run. */
  permission: Permission | readonly Permission[];
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
  readonly sideEffect: AiSideEffect;
  readonly sources: readonly string[];
  /** Permission gate → input validation → run → provenance. Never throws. */
  execute: (ctx: AiActionContext, input: unknown) => Promise<AiToolResult>;
  /** The AI SDK tool bound to `ctx`. */
  toTool: (ctx: AiActionContext) => Tool;
};

export function canRunAiAction(
  roles: readonly Role[],
  permissions: readonly Permission[],
): boolean {
  return permissions.every((p) => userCan(roles, p));
}

function toPermissions(
  permission: Permission | readonly Permission[],
): readonly Permission[] {
  return typeof permission === "string" ? [permission] : permission;
}

export function defineAiAction<S extends z.ZodType>(
  def: AiActionDefinition<S>,
): AiAction {
  const permissions = toPermissions(def.permission);

  async function execute(
    ctx: AiActionContext,
    input: unknown,
  ): Promise<AiToolResult> {
    if (!canRunAiAction(ctx.roles, permissions)) {
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
    permissions,
    sideEffect: def.sideEffect,
    sources: def.sources,
    execute,
    toTool: (ctx) =>
      tool({
        description: def.description,
        inputSchema: def.input,
        execute: (input) => execute(ctx, input),
      }),
  };
}
