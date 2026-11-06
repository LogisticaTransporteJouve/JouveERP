import { getToolName, isToolUIPart, type UIMessage } from "ai";

import {
  ARTIFACT_PART,
  RENDER_CHART_TOOL,
  RENDER_TABLE_TOOL,
  artifactSchema,
  type Artifact,
} from "../artifacts/spec";

import { artifactPartId } from "./chat-segments";

export type ArtifactKind = Artifact["kind"];

/** One chart or table of the conversation, as the canvas shows it: still
 *  being built (its tool call is running), ready, or failed (the tool call
 *  failed, or what it sent does not parse). */
export type ArtifactEntry =
  | { id: string; status: "building"; kind: ArtifactKind }
  | { id: string; status: "error"; kind: ArtifactKind }
  | { id: string; status: "ready"; kind: ArtifactKind; artifact: Artifact };

function toolKind(name: string): ArtifactKind | null {
  if (name === RENDER_CHART_TOOL) return "chart";
  if (name === RENDER_TABLE_TOOL) return "table";
  return null;
}

/**
 * The conversation's artifacts in transcript order, keyed by id. The render
 * tool call and the `data-artifact` part it emits share the tool call id, so
 * an artifact shows as building from the call's first chunk and as ready
 * once its part arrives.
 */
export function artifactEntries(
  messages: readonly UIMessage[],
): Map<string, ArtifactEntry> {
  const entries = new Map<string, ArtifactEntry>();
  for (const m of messages) {
    m.parts.forEach((part, index) => {
      if (part.type === ARTIFACT_PART) {
        const id = artifactPartId(m.id, part.id, index);
        const parsed = artifactSchema.safeParse(part.data);
        const kind = entries.get(id)?.kind ?? "table";
        entries.set(
          id,
          parsed.success
            ? {
                id,
                status: "ready",
                kind: parsed.data.kind,
                artifact: parsed.data,
              }
            : { id, status: "error", kind },
        );
        return;
      }
      if (!isToolUIPart(part)) return;
      const kind = toolKind(getToolName(part));
      if (!kind) return;
      const id = part.toolCallId;
      if (entries.get(id)?.status === "ready") return;
      // A finished call with no part: the query failed or the turn's
      // artifact budget was spent.
      const done =
        part.state === "output-error" || part.state === "output-available";
      entries.set(id, { id, status: done ? "error" : "building", kind });
    });
  }
  return entries;
}

/** Which artifact the canvas shows and whether it is open. Closing keeps
 *  the current one, so its chat card can reopen it. */
export type CanvasState = { currentId: string | null; open: boolean };

/** A saved conversation opens on its last artifact (only where the canvas
 *  sits beside the chat: on a narrow screen it would cover it). */
export function initialCanvas(
  ids: readonly string[],
  wide: boolean,
): CanvasState {
  const last = ids.at(-1) ?? null;
  return { currentId: last, open: last !== null && wide };
}

/** The newest artifact not seen before takes the canvas and opens it. */
export function followNewest(
  state: CanvasState,
  seen: ReadonlySet<string>,
  ids: readonly string[],
): CanvasState {
  const newest = ids.filter((id) => !seen.has(id)).at(-1);
  return newest ? { currentId: newest, open: true } : state;
}
