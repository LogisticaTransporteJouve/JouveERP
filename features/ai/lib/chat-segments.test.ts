import { describe, expect, it } from "vitest";

import { segmentParts, type ChatPart } from "./chat-segments";

describe("segmentParts", () => {
  it("keeps transcript order: text after a card renders after it", () => {
    const parts: ChatPart[] = [
      { type: "text", text: "Te armo la propuesta." },
      {
        type: "tool-getEmployees",
        toolCallId: "r1",
        state: "output-available",
        input: {},
        output: {},
      },
      {
        type: "tool-proposeLeave",
        toolCallId: "p1",
        state: "output-available",
        input: {},
        output: {},
      },
      { type: "text", text: "Confirmala en la tarjeta." },
    ];
    const segments = segmentParts(parts);
    expect(segments.map((s) => s.kind)).toEqual(["bubble", "card", "bubble"]);
    expect(segments[0]).toMatchObject({ kind: "bubble" });
    if (segments[0]?.kind === "bubble") {
      expect(segments[0].parts.map((p) => p.index)).toEqual([0, 1]);
    }
    expect(segments[2]).toMatchObject({
      kind: "bubble",
      parts: [{ index: 3 }],
    });
  });

  it("makes the question card its own segment", () => {
    const segments = segmentParts([
      {
        type: "tool-askQuestions",
        toolCallId: "q1",
        state: "input-available",
        input: {},
      },
    ]);
    expect(segments).toEqual([
      {
        kind: "card",
        index: 0,
        part: expect.objectContaining({ toolCallId: "q1" }),
      },
    ]);
  });
});
