import { AI_ACTIONS } from "../registry/catalog";
import {
  canRunAiAction,
  type AiAction,
  type AiActionContext,
} from "../registry/define";

import {
  buildChartArtifact,
  buildTableArtifact,
  type BuildResult,
} from "./build";
import { LEGACY_FIELDS_NOTE, upgradeLegacyFields } from "./legacy-fields";
import { resolveRows } from "./rows";
import type { Artifact, ArtifactMeta, PinRequest } from "./spec";

/** The read actions an artifact may be built from, for these roles. The
 *  artifact tools themselves never appear here (they are not registry
 *  actions), so a chart cannot be built from another chart. */
export function artifactSourceActions(
  roles: AiActionContext["roles"],
  actions: readonly AiAction[] = AI_ACTIONS,
): AiAction[] {
  return actions.filter(
    (a) => a.sideEffect === "read" && canRunAiAction(roles, a.permissions),
  );
}

export type ArtifactRun =
  | { ok: true; artifact: Artifact; input: unknown }
  | { ok: false; error: string; denied: boolean };

/**
 * Runs the source read action as `ctx` — the action's own permission gate
 * and input schema apply, exactly as when the model calls it — and builds
 * the artifact from the rows it returns. `input` is the parsed source input
 * (what a pin stores).
 */
export async function runArtifact(
  ctx: AiActionContext,
  request: PinRequest,
  actions?: readonly AiAction[],
): Promise<ArtifactRun> {
  const action = artifactSourceActions(ctx.roles, actions).find(
    (a) => a.name === request.source.action,
  );
  if (!action) {
    return {
      ok: false,
      error: `"${request.source.action}" is not a query available to this user.`,
      denied: true,
    };
  }
  const parsedInput = action.input?.safeParse(request.source.input);
  if (!parsedInput?.success) {
    return {
      ok: false,
      error: parsedInput?.error.issues[0]?.message ?? "Invalid input.",
      denied: false,
    };
  }
  const res = await action.execute(ctx, request.source.input);
  if (!res.ok) return { ok: false, error: res.error, denied: false };

  const rows = resolveRows(res.data);
  if (!rows) {
    return {
      ok: false,
      error: "The query returned no rows to show.",
      denied: false,
    };
  }
  const input: {
    source: PinRequest["source"];
    rows: typeof rows;
    meta: ArtifactMeta;
  } = {
    source: request.source,
    rows,
    meta: {
      sources: [...res.meta.sources],
      asOf: res.meta.asOf,
      partial: res.meta.partial,
      ...(res.meta.currency ? { currency: res.meta.currency } : {}),
      ...(res.meta.note ? { note: res.meta.note } : {}),
    },
  };
  const present = new Set(rows.flatMap((r) => Object.keys(r)));
  const { request: current, upgraded } = upgradeLegacyFields(request, present);
  if (upgraded) {
    input.meta.note = input.meta.note
      ? `${input.meta.note} ${LEGACY_FIELDS_NOTE}`
      : LEGACY_FIELDS_NOTE;
  }
  const built: BuildResult<Artifact> =
    current.kind === "chart"
      ? buildChartArtifact(current.config, input)
      : buildTableArtifact(current.config, input);
  if (!built.ok) return { ok: false, error: built.error, denied: false };
  return { ok: true, artifact: built.value, input: parsedInput.data };
}
