import { ARTIFACT_LIMITS, type Artifact } from "./spec";

/**
 * Where artifact tools hand what they built to the chat stream (a
 * `data-artifact` part keyed by the tool call). The chat route binds it to
 * the response writer; without one, the artifact tools are not offered.
 * `emit` is false when the artifact was not sent (the turn's size budget is
 * spent, or no stream is attached).
 */
export interface AiArtifactSink {
  emit(id: string, artifact: Artifact): boolean;
}

/** Chunk shape the sink writes; a UI message stream writer accepts it. */
export type ArtifactChunk = {
  type: "data-artifact";
  id: string;
  data: Artifact;
};

/** A sink for one turn: writes to the attached writer while the artifacts it
 *  sent stay within the turn's byte budget (they are persisted with the
 *  message). */
export function createArtifactSink(
  turnBytes: number = ARTIFACT_LIMITS.turnBytes,
): AiArtifactSink & {
  attach: (write: (chunk: ArtifactChunk) => void) => void;
} {
  let write: ((chunk: ArtifactChunk) => void) | null = null;
  let spent = 0;
  return {
    attach: (fn) => {
      write = fn;
    },
    emit: (id, artifact) => {
      const size = JSON.stringify(artifact).length;
      if (!write || spent + size > turnBytes) return false;
      spent += size;
      write({ type: "data-artifact", id, data: artifact });
      return true;
    },
  };
}
