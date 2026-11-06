import type { MockLanguageModelV4 } from "ai/test";

import { TURN_CONTEXT_OPEN } from "../agent";
import { estimateCostUsd } from "../lib/pricing";
import { AI_CHAT_MODEL } from "../model";

export type CallOptions = Parameters<MockLanguageModelV4["doStream"]>[0];

/** Rough chars-per-token for Spanish prose mixed with JSON on Claude's
 *  tokenizer; the report is an estimate, not a count. */
export const CHARS_PER_TOKEN = 3.5;

export const estimateTokens = (chars: number): number =>
  Math.round(chars / CHARS_PER_TOKEN);

export type RequestPart =
  | "system"
  | "volatile"
  | "tools"
  | "history"
  | "historyToolResults"
  | "turn"
  | "turnToolResults";

type Block = { part: RequestPart; text: string; breakpoint: boolean };

function hasBreakpoint(providerOptions: unknown): boolean {
  if (typeof providerOptions !== "object" || providerOptions === null) {
    return false;
  }
  const anthropic = Reflect.get(providerOptions, "anthropic");
  return (
    typeof anthropic === "object" &&
    anthropic !== null &&
    Reflect.get(anthropic, "cacheControl") !== undefined
  );
}

/** The request as Anthropic receives it, in its cache order (tools, system,
 *  messages), one block per tool / system message / message part. */
export function requestBlocks(options: CallOptions): Block[] {
  const blocks: Block[] = [];
  for (const t of options.tools ?? []) {
    blocks.push({ part: "tools", text: JSON.stringify(t), breakpoint: false });
  }
  const prompt = options.prompt;
  const lastUser = prompt.findLastIndex((m) => m.role === "user");
  let seenSystemBreakpoint = false;
  prompt.forEach((message, index) => {
    if (message.role === "system") {
      const breakpoint = hasBreakpoint(message.providerOptions);
      blocks.push({
        part: seenSystemBreakpoint || !breakpoint ? "volatile" : "system",
        text: message.content,
        breakpoint,
      });
      if (breakpoint) seenSystemBreakpoint = true;
      return;
    }
    const inTurn = index >= lastUser;
    message.content.forEach((part, i) => {
      const last = i === message.content.length - 1;
      const breakpoint =
        hasBreakpoint(part.providerOptions) ||
        (last && hasBreakpoint(message.providerOptions));
      const isResult = part.type === "tool-result";
      const isVolatile =
        part.type === "text" && part.text.startsWith(TURN_CONTEXT_OPEN);
      blocks.push({
        part: isVolatile
          ? "volatile"
          : isResult
            ? inTurn
              ? "turnToolResults"
              : "historyToolResults"
            : inTurn
              ? "turn"
              : "history",
        text: JSON.stringify(part),
        breakpoint,
      });
    });
  });
  return blocks;
}

export type CallReport = {
  tokens: Record<RequestPart, number>;
  input: number;
  cacheRead: number;
  cacheWrite: number;
};

const ZERO_PARTS = (): Record<RequestPart, number> => ({
  system: 0,
  volatile: 0,
  tools: 0,
  history: 0,
  historyToolResults: 0,
  turn: 0,
  turnToolResults: 0,
});

/**
 * Prices a sequence of requests (the steps of one turn) under Anthropic's
 * prefix cache: a block is read from cache when the request shares every
 * block before it, up to a breakpoint, with a prefix written earlier; the
 * blocks up to its own last breakpoint are written; the rest is uncached.
 * `warm` are prefixes assumed already cached (e.g. tools + system from an
 * earlier turn).
 */
export function simulateTurn(
  calls: CallOptions[],
  warm: "toolsAndSystem" | "none" = "toolsAndSystem",
): { calls: CallReport[]; total: CallReport } {
  const cached: string[][] = [];
  const reports = calls.map((options): CallReport => {
    const blocks = requestBlocks(options);
    const texts = blocks.map((b) => b.text);
    if (cached.length === 0 && warm === "toolsAndSystem") {
      const end = blocks.findIndex((b) => b.part === "system" && b.breakpoint);
      if (end >= 0) cached.push(texts.slice(0, end + 1));
    }
    let readUpTo = 0;
    for (const prefix of cached) {
      if (
        prefix.length > readUpTo &&
        prefix.length <= texts.length &&
        prefix.every((t, i) => texts[i] === t)
      ) {
        readUpTo = prefix.length;
      }
    }
    const lastBreakpoint = blocks.findLastIndex((b) => b.breakpoint);
    const writeUpTo = Math.max(readUpTo, lastBreakpoint + 1);
    for (let i = readUpTo; i < writeUpTo; i++) {
      if (blocks[i]?.breakpoint) cached.push(texts.slice(0, i + 1));
    }
    const tokens = ZERO_PARTS();
    let cacheRead = 0;
    let cacheWrite = 0;
    blocks.forEach((b, i) => {
      const n = estimateTokens(b.text.length);
      tokens[b.part] += n;
      if (i < readUpTo) cacheRead += n;
      else if (i < writeUpTo) cacheWrite += n;
    });
    const input = Object.values(tokens).reduce((a, b) => a + b, 0);
    return { tokens, input, cacheRead, cacheWrite };
  });
  const total = reports.reduce<CallReport>(
    (acc, r) => {
      for (const k of Object.keys(acc.tokens) as RequestPart[]) {
        acc.tokens[k] += r.tokens[k];
      }
      acc.input += r.input;
      acc.cacheRead += r.cacheRead;
      acc.cacheWrite += r.cacheWrite;
      return acc;
    },
    { tokens: ZERO_PARTS(), input: 0, cacheRead: 0, cacheWrite: 0 },
  );
  return { calls: reports, total };
}

/** USD of a turn at the chat model's rates (lib/pricing.ts). */
export function turnCostUsd(total: CallReport, outputTokens: number): number {
  return estimateCostUsd(
    {
      inputTokens: total.input,
      outputTokens,
      cacheReadTokens: total.cacheRead,
      cacheWriteTokens: total.cacheWrite,
    },
    AI_CHAT_MODEL,
  );
}
