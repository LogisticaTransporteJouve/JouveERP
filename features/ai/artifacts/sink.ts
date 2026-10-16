import type { Artifact } from "./spec";

/**
 * Where artifact tools hand what they built to the chat stream (a
 * `data-artifact` part keyed by the tool call). The chat route binds it to
 * the response writer; without one, the artifact tools are not offered.
 */
export interface AiArtifactSink {
  emit(id: string, artifact: Artifact): void;
}

/** Chunk shape the sink writes; a UI message stream writer accepts it. */
export type ArtifactChunk = {
  type: "data-artifact";
  id: string;
  data: Artifact;
};

/** A sink that writes to whatever writer gets attached; artifacts emitted
 *  before that are dropped (the stream is not open yet). */
export function createArtifactSink(): AiArtifactSink & {
  attach: (write: (chunk: ArtifactChunk) => void) => void;
} {
  let write: ((chunk: ArtifactChunk) => void) | null = null;
  return {
    attach: (fn) => {
      write = fn;
    },
    emit: (id, artifact) => {
      write?.({ type: "data-artifact", id, data: artifact });
    },
  };
}
