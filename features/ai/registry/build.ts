import type { ToolSet } from "ai";

import type { Role } from "@/lib/auth/permissions";

import {
  buildArtifactTools,
  RENDER_CHART_TOOL,
  RENDER_TABLE_TOOL,
} from "../artifacts/tools";
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
 *  question card every chat user may get and, when the context carries an
 *  artifact sink and the user has a read query, the chart and table tools. */
export function buildAiTools(
  ctx: AiActionContext,
  actions: readonly AiAction[] = AI_ACTIONS,
): ToolSet {
  const tools: ToolSet = { [ASK_QUESTIONS_TOOL]: askQuestionsTool };
  const visible = visibleAiActions(ctx.roles, actions);
  for (const action of visible) {
    tools[action.name] = action.toTool(ctx);
  }
  if (ctx.artifacts && visible.some((a) => a.sideEffect === "read")) {
    Object.assign(tools, buildArtifactTools(ctx, ctx.artifacts, actions));
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
  options: { artifacts?: boolean } = {},
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
  if (options.artifacts && visible.some((a) => a.sideEffect === "read")) {
    sections.push(
      `Gráficos y tablas:\n- ${RENDER_CHART_TOOL}: mostrá un gráfico armado por el servidor con el resultado de una de tus consultas; usalo cuando una comparación o una evolución se entiende mejor vista.\n- ${RENDER_TABLE_TOOL}: mostrá una tabla exportable a CSV con el resultado de una de tus consultas, cuando piden un listado o exportar.`,
    );
  }
  return sections.length > 0
    ? sections.join("\n\n")
    : "(Sin consultas disponibles para tu rol.)";
}
