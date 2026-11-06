import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { buildChartArtifact, buildTableArtifact } from "../artifacts/build";
import type { Artifact } from "../artifacts/spec";

import {
  artifactEntries,
  followNewest,
  initialCanvas,
} from "./artifact-canvas";

const source = { action: "getExpenseByCategory", input: {} };
const meta = { sources: ["x"], asOf: "2026-11-01T12:00:00Z", partial: false };
const rows = [
  { category: "Combustible", total: 1500 },
  { category: "Peajes", total: 320 },
];

function table(title: string): Artifact {
  const res = buildTableArtifact({ title }, { source, rows, meta });
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

function chart(title: string): Artifact {
  const res = buildChartArtifact(
    { type: "bar", title },
    { source, rows, meta },
  );
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

type Part = UIMessage["parts"][number];

function call(
  id: string,
  state: "input-streaming" | "output-available" | "output-error",
  tool = "renderTable",
): Part {
  if (state === "output-error") {
    return {
      type: `tool-${tool}`,
      toolCallId: id,
      state,
      input: {},
      errorText: "boom",
    };
  }
  if (state === "output-available") {
    return {
      type: `tool-${tool}`,
      toolCallId: id,
      state,
      input: {},
      output: { ok: true },
    };
  }
  return { type: `tool-${tool}`, toolCallId: id, state, input: undefined };
}

function msg(id: string, parts: Part[]): UIMessage {
  return { id, role: "assistant", parts };
}

describe("artifactEntries", () => {
  it("shows a render call as building, then ready once its part arrives", () => {
    const building = artifactEntries([
      msg("m1", [call("t1", "input-streaming", "renderChart")]),
    ]);
    expect(building.get("t1")).toEqual({
      id: "t1",
      status: "building",
      kind: "chart",
    });

    const ready = artifactEntries([
      msg("m1", [
        call("t1", "output-available", "renderChart"),
        { type: "data-artifact", id: "t1", data: chart("Gasto") },
      ]),
    ]);
    expect(ready.get("t1")).toMatchObject({ status: "ready", kind: "chart" });
  });

  it("marks a finished call with no artifact, and an unreadable part, as failed", () => {
    const entries = artifactEntries([
      msg("m1", [
        call("t1", "output-error"),
        call("t2", "output-available"),
        { type: "data-artifact", id: "t3", data: { kind: "chart" } },
      ]),
    ]);
    expect([...entries.values()].map((e) => e.status)).toEqual([
      "error",
      "error",
      "error",
    ]);
  });

  it("keeps transcript order across messages and ignores other tools", () => {
    const entries = artifactEntries([
      msg("m1", [
        {
          type: "tool-getClientAging",
          toolCallId: "q1",
          state: "output-available",
          input: {},
          output: { ok: true },
        },
        { type: "data-artifact", id: "a", data: table("Uno") },
      ]),
      msg("m2", [{ type: "data-artifact", data: table("Dos") }]),
    ]);
    expect([...entries.keys()]).toEqual(["a", "m2:0"]);
  });
});

describe("canvas state", () => {
  it("opens a saved conversation on its last artifact only beside the chat", () => {
    expect(initialCanvas(["a", "b"], true)).toEqual({
      currentId: "b",
      open: true,
    });
    expect(initialCanvas(["a", "b"], false)).toEqual({
      currentId: "b",
      open: false,
    });
    expect(initialCanvas([], true)).toEqual({ currentId: null, open: false });
  });

  it("lets the newest unseen artifact take the canvas", () => {
    const closed = { currentId: "a", open: false };
    expect(followNewest(closed, new Set(["a"]), ["a"])).toBe(closed);
    expect(followNewest(closed, new Set(["a"]), ["a", "b", "c"])).toEqual({
      currentId: "c",
      open: true,
    });
  });
});
