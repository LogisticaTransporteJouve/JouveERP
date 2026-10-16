import { getToolName, isToolUIPart, type UIMessage } from "ai";

import { PROPOSAL_SPECS } from "./proposal-specs";
import { ASK_QUESTIONS_TOOL } from "./questions";

export type ChatPart = UIMessage["parts"][number];

/** A run of parts that read as the assistant's speech (text, tool status,
 *  small tables), or a standalone card the user acts on. */
export type ChatSegment =
  | { kind: "bubble"; parts: { part: ChatPart; index: number }[] }
  | { kind: "card"; part: ChatPart; index: number };

function isCardPart(part: ChatPart): boolean {
  if (!isToolUIPart(part)) return false;
  const name = getToolName(part);
  return name === ASK_QUESTIONS_TOOL || name in PROPOSAL_SPECS;
}

/** Splits a message into segments in transcript order, so text written after
 *  a card renders after it. */
export function segmentParts(parts: readonly ChatPart[]): ChatSegment[] {
  const segments: ChatSegment[] = [];
  parts.forEach((part, index) => {
    if (isCardPart(part)) {
      segments.push({ kind: "card", part, index });
      return;
    }
    const last = segments.at(-1);
    if (last?.kind === "bubble") last.parts.push({ part, index });
    else segments.push({ kind: "bubble", parts: [{ part, index }] });
  });
  return segments;
}
