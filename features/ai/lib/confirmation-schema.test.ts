import { describe, expect, it } from "vitest";

import {
  hasPendingConfirmation,
  latestForCard,
  type AiConfirmation,
} from "./confirmation-schema";

const base: AiConfirmation = {
  id: "c1",
  session_id: "s1",
  tool_call_id: "call-1",
  action: "proposeExchangeRate",
  revision_key: "k1",
  revision: 1,
  origin: "assistant",
  draft: {},
  labels: {},
  summary: [],
  status: "superseded",
  result_id: null,
  error: null,
  created_at: "2026-10-16T12:00:00Z",
  decided_at: null,
};

describe("latestForCard", () => {
  it("shows the card's newest revision (the user's edit)", () => {
    const rows: AiConfirmation[] = [
      base,
      { ...base, id: "c2", revision: 2, origin: "user", status: "pending" },
      {
        ...base,
        id: "c3",
        tool_call_id: "call-2",
        revision: 3,
        status: "pending",
      },
    ];
    expect(latestForCard(rows, "call-1")?.id).toBe("c2");
    expect(latestForCard(rows, "call-9")).toBeUndefined();
  });
});

describe("hasPendingConfirmation", () => {
  it("holds the composer only for a pending card the transcript shows", () => {
    const pending: AiConfirmation = { ...base, status: "pending" };
    expect(hasPendingConfirmation([pending], new Set(["call-1"]))).toBe(true);
    expect(hasPendingConfirmation([pending], new Set(["call-2"]))).toBe(false);
    expect(hasPendingConfirmation([base], new Set(["call-1"]))).toBe(false);
  });
});
