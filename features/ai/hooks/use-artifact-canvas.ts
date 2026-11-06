"use client";

import type { UIMessage } from "ai";
import { useMemo, useState } from "react";

import {
  artifactEntries,
  followNewest,
  initialCanvas,
  type ArtifactEntry,
  type CanvasState,
} from "../lib/artifact-canvas";

/** Tailwind's `lg`, where the canvas sits beside the chat. */
const WIDE_QUERY = "(min-width: 64rem)";

function isWide(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(WIDE_QUERY).matches
  );
}

/**
 * The chat's artifact canvas: one artifact at a time, read live from the
 * messages. A saved conversation opens on its last artifact; each new one
 * takes the canvas (building, then ready) as it streams in.
 */
export function useArtifactCanvas(messages: readonly UIMessage[]) {
  const entries = useMemo(() => artifactEntries(messages), [messages]);
  const ids = useMemo(() => [...entries.keys()], [entries]);
  const [state, setState] = useState<CanvasState>(() =>
    initialCanvas(ids, isWide()),
  );
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(ids));

  // Adjusted while rendering (not in an effect) so a new artifact opens in
  // the same paint its first chunk shows up in.
  if (ids.some((id) => !seen.has(id))) {
    setState(followNewest(state, seen, ids));
    setSeen(new Set([...seen, ...ids]));
  }

  const current: ArtifactEntry | null =
    state.currentId !== null ? (entries.get(state.currentId) ?? null) : null;

  return {
    entries,
    current,
    open: state.open && current !== null,
    show: (id: string) => setState({ currentId: id, open: true }),
    close: () => setState((s) => ({ ...s, open: false })),
  };
}
