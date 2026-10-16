import type { Role } from "@/lib/auth/permissions";

import { CFO_BASE_PROMPT, buildSystemPrompt } from "./agent";
import {
  AI_ACTIONS,
  buildCapabilitiesSummary,
  visibleAiActions,
  type AiAction,
} from "./registry";

/**
 * Background runs (scheduled tasks, the weekly summary) act for a user who is
 * not there: only `read` actions, never a proposal or the question card, and
 * only those the user's roles allow right now.
 */
export function headlessReadActions(
  roles: readonly Role[],
  actions: readonly AiAction[] = AI_ACTIONS,
): AiAction[] {
  return visibleAiActions(roles, actions).filter(
    (a) => a.sideEffect === "read",
  );
}

/** Replaces the chat-only rules for a run with nobody on the other side. */
export const HEADLESS_RULES = `Esta corrida es automática: el usuario no está en la conversación.
- No podés preguntar (no hay askQuestions) ni proponer cambios (no hay herramientas de propuesta): solo consultás datos y respondés.
- Si un dato no está disponible con tus consultas, decilo en una línea y seguí con el resto.
- Escribí el resultado listo para leer: un título corto, los hallazgos con cifras, fuente y fecha, y qué cambió respecto de la corrida anterior si la hay.`;

/** The CFO prompt with the read-only capabilities of `roles`, plus the
 *  background-run rules. */
export function buildHeadlessSystemPrompt(roles: readonly Role[]): string {
  return `${buildSystemPrompt(
    buildCapabilitiesSummary(roles, headlessReadActions(roles)),
  )}

${HEADLESS_RULES}`;
}

/** The persona and rules alone, for a background call without tools (the
 *  weekly summary writes over figures it is handed). */
export const HEADLESS_WRITER_PROMPT = `${CFO_BASE_PROMPT}

${HEADLESS_RULES}`;
