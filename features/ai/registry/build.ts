import type { ToolSet } from "ai";

import type { Access } from "@/lib/auth/permissions";

import {
  buildArtifactTools,
  RENDER_CALENDAR_TOOL,
  RENDER_CHART_TOOL,
  RENDER_TABLE_TOOL,
} from "../artifacts/tools";
import { ASK_QUESTIONS_TOOL } from "../lib/questions";
import { toolLabel } from "../lib/tool-labels";

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

/** The actions this access may run: anything else is never shown to the
 *  model, so it cannot even name a tool the user lacks permission for. */
export function visibleAiActions(
  access: Access,
  actions: readonly AiAction[] = AI_ACTIONS,
): AiAction[] {
  return actions.filter((a) => canRunAiAction(access, a));
}

/** The chat tools for one user, generated from the registry, plus the
 *  question card every chat user may get and, when the context carries an
 *  artifact sink and the user has a read query, the chart and table tools. */
export function buildAiTools(
  ctx: AiActionContext,
  actions: readonly AiAction[] = AI_ACTIONS,
): ToolSet {
  const tools: ToolSet = { [ASK_QUESTIONS_TOOL]: askQuestionsTool };
  const visible = visibleAiActions(ctx.access, actions);
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

/** How a chat answer splits between the chat and the results panel; only
 *  where the chart and table tools are offered. */
export const ANSWER_FORMAT = `Formato de la respuesta (el chat queda a la izquierda y las tablas y gráficos se abren en un panel a la derecha):
- Datos tabulares o comparaciones (2 o más filas por 2 o más columnas, o cifras por categoría, alícuota, cliente o período) van siempre al panel con ${RENDER_TABLE_TOOL} o ${RENDER_CHART_TOOL}, que el usuario puede exportar y fijar. Nunca escribas una tabla en markdown (filas con |) en la respuesta.
- Si la comparación sale de varias consultas (ej. IVA ventas contra IVA compras), mostrá cada consulta con su tabla o gráfico y dejá en el texto solo las cifras que las comparan.
- El texto es una conclusión corta: hasta 5 líneas con las cifras clave en negrita y, si hace falta, unas pocas viñetas. No repitas lo que ya muestra la tabla o el gráfico.`;

/** One line per visible action, grouped by domain, for the system prompt.
 *  Proposals are marked so the model knows they only draft. */
export function buildCapabilitiesSummary(
  access: Access,
  actions: readonly AiAction[] = AI_ACTIONS,
  options: { artifacts?: boolean } = {},
): string {
  const visible = visibleAiActions(access, actions);
  const sections: string[] = [];
  for (const domain of AI_DOMAINS) {
    const lines = visible
      .filter((a) => a.domain === domain)
      .map(
        (a) =>
          `- ${a.name} («${toolLabel(a.name)}»)${a.sideEffect === "propose" ? " (propuesta, requiere confirmación)" : ""}: ${firstSentence(a.description)}`,
      );
    if (lines.length > 0) {
      sections.push(`${DOMAIN_LABEL[domain]}:\n${lines.join("\n")}`);
    }
  }
  if (options.artifacts && visible.some((a) => a.sideEffect === "read")) {
    sections.push(
      `Gráficos y tablas:\n- ${RENDER_CHART_TOOL}: mostrá un gráfico armado por el servidor con el resultado de una de tus consultas; usalo cuando una comparación o una evolución se entiende mejor vista.\n- ${RENDER_TABLE_TOOL}: mostrá una tabla exportable a CSV con el resultado de una de tus consultas, cuando piden un listado o exportar.\n- ${RENDER_CALENDAR_TOOL}: mostrá un mes como calendario (una fila por empleado, una columna por día, cada día con la letra del tipo de licencia) armado con getLeavesByRange, cuando preguntan quién se toma vacaciones o licencia en un mes.`,
      ANSWER_FORMAT,
    );
  }
  return sections.length > 0
    ? sections.join("\n\n")
    : "(Sin consultas disponibles para tu rol.)";
}
