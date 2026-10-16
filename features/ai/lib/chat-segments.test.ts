import { describe, expect, it } from "vitest";

import { activitySteps } from "./activity";
import { isCardPart, segmentParts, type ChatPart } from "./chat-segments";

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
    expect(segments[0]).toMatchObject({
      kind: "bubble",
      parts: [{ index: 0 }],
    });
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

  it("renders artifacts in place and leaves read tool calls to the activity block", () => {
    const segments = segmentParts([
      { type: "step-start" },
      {
        type: "tool-renderChart",
        toolCallId: "c1",
        state: "output-available",
        input: {},
        output: {},
      },
      { type: "data-artifact", id: "c1", data: { kind: "chart" } },
      { type: "text", text: "  " },
      { type: "text", text: "Ahí está." },
    ]);
    expect(segments).toEqual([
      { kind: "artifact", id: "c1", index: 2, data: { kind: "chart" } },
      {
        kind: "bubble",
        parts: [{ index: 4, part: { type: "text", text: "Ahí está." } }],
      },
    ]);
  });
});

describe("activitySteps", () => {
  it("lists the turn's tool calls with rows, provenance and status, skipping cards", () => {
    const steps = activitySteps(
      [
        {
          type: "tool-getInvoices",
          toolCallId: "a",
          state: "output-available",
          input: {},
          output: {
            ok: true,
            summary: "2 rows",
            data: [{ id: 1 }, { id: 2 }],
            meta: {
              sources: ["invoices"],
              asOf: "2026-10-16T12:00:00Z",
              partial: true,
            },
          },
        },
        {
          type: "tool-getLedger",
          toolCallId: "b",
          state: "output-available",
          input: {},
          output: { ok: false, summary: "Failed", error: "x" },
        },
        {
          type: "tool-getTrips",
          toolCallId: "c",
          state: "input-available",
          input: {},
        },
        {
          type: "tool-askQuestions",
          toolCallId: "q",
          state: "input-available",
          input: {},
        },
      ],
      isCardPart,
    );
    expect(steps.map((s) => [s.name, s.status, s.rows, s.partial])).toEqual([
      ["getInvoices", "done", 2, true],
      ["getLedger", "error", null, false],
      ["getTrips", "running", null, false],
    ]);
    expect(steps[0]?.sources).toEqual(["invoices"]);
  });
});
