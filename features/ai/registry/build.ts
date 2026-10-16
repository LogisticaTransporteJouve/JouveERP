import type { ToolSet } from "ai";

import type { Role } from "@/lib/auth/permissions";

import { ASK_QUESTIONS_TOOL } from "../lib/questions";

import { askQuestionsTool } from "./ask-questions";
import { AI_ACTIONS } from "./catalog";
import {
  AI_DOMAINS,
  canRunAiAction,
  type AiAction,
  type AiActionContext,
  type AiDomain,
} from "./define";

const DOMAIN_LABEL: Record<AiDomain, string> = {
  ventas: "Ventas y cobranzas",
  compras: "Compras y proveedores",
  tesoreria: "Tesorería",
  contabilidad: "Contabilidad",
  rrhh: "RRHH y sueldos",
  flota: "Flota y transporte",
  deposito: "Depósito",
  afip: "AFIP",
  general: "General",
};

/** The actions these roles may run: anything else is never shown to the
 *  model, so it cannot even name a tool the user lacks permission for. */
export function visibleAiActions(
  roles: readonly Role[],
  actions: readonly AiAction[] = AI_ACTIONS,
): AiAction[] {
  return actions.filter((a) => canRunAiAction(roles, a.permissions));
}

/** The chat tools for one user, generated from the registry, plus the
 *  question card every chat user may get. */
export function buildAiTools(
  ctx: AiActionContext,
  actions: readonly AiAction[] = AI_ACTIONS,
): ToolSet {
  const tools: ToolSet = { [ASK_QUESTIONS_TOOL]: askQuestionsTool };
  for (const action of visibleAiActions(ctx.roles, actions)) {
    tools[action.name] = action.toTool(ctx);
  }
  return tools;
}

function firstSentence(text: string): string {
  const end = text.search(/[.:](\s|$)/);
  return (end === -1 ? text : text.slice(0, end)).trim();
}

/** One line per visible action, grouped by domain, for the system prompt.
 *  Proposals are marked so the model knows they only draft. */
export function buildCapabilitiesSummary(
  roles: readonly Role[],
  actions: readonly AiAction[] = AI_ACTIONS,
): string {
  const visible = visibleAiActions(roles, actions);
  const sections: string[] = [];
  for (const domain of AI_DOMAINS) {
    const lines = visible
      .filter((a) => a.domain === domain)
      .map(
        (a) =>
          `- ${a.name}${a.sideEffect === "propose" ? " (propuesta, requiere confirmación)" : ""}: ${firstSentence(a.description)}`,
      );
    if (lines.length > 0) {
      sections.push(`${DOMAIN_LABEL[domain]}:\n${lines.join("\n")}`);
    }
  }
  return sections.length > 0
    ? sections.join("\n\n")
    : "(Sin consultas disponibles para tu rol.)";
}
