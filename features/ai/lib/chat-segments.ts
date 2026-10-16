import { getToolName, isToolUIPart, type UIMessage } from "ai";

import { ARTIFACT_PART } from "../artifacts/spec";
import { readAttachmentPart, type ChatAttachment } from "../attachments/schema";

import { PROPOSAL_SPECS } from "./proposal-specs";
import { ASK_QUESTIONS_TOOL } from "./questions";

export type ChatPart = UIMessage["parts"][number];

/** A run of text the assistant (or user) wrote, a standalone card the user
 *  acts on, a chart/table artifact, or a run of files the user attached.
 *  Other tool calls are not segments: the turn's activity block lists them. */
export type ChatSegment =
  | { kind: "bubble"; parts: { part: ChatPart; index: number }[] }
  | { kind: "card"; part: ChatPart; index: number }
  | { kind: "artifact"; data: unknown; id: string; index: number }
  | { kind: "attachments"; attachments: ChatAttachment[]; index: number };

export function isCardPart(part: ChatPart): boolean {
  if (!isToolUIPart(part)) return false;
  const name = getToolName(part);
  return name === ASK_QUESTIONS_TOOL || name in PROPOSAL_SPECS;
}

/** Splits a message into segments in transcript order, so text written after
 *  a card or a chart renders after it. */
export function segmentParts(parts: readonly ChatPart[]): ChatSegment[] {
  const segments: ChatSegment[] = [];
  parts.forEach((part, index) => {
    if (isCardPart(part)) {
      segments.push({ kind: "card", part, index });
      return;
    }
    if (part.type === ARTIFACT_PART) {
      segments.push({
        kind: "artifact",
        data: part.data,
        id: part.id ?? String(index),
        index,
      });
      return;
    }
    const attachment = readAttachmentPart(part);
    if (attachment) {
      const last = segments.at(-1);
      if (last?.kind === "attachments") last.attachments.push(attachment);
      else
        segments.push({
          kind: "attachments",
          attachments: [attachment],
          index,
        });
      return;
    }
    if (part.type !== "text" || part.text.trim() === "") return;
    const last = segments.at(-1);
    if (last?.kind === "bubble") last.parts.push({ part, index });
    else segments.push({ kind: "bubble", parts: [{ part, index }] });
  });
  return segments;
}
