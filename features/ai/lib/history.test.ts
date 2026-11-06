import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  HISTORY_INPUT_MAX_CHARS,
  HISTORY_RESULT_MAX_CHARS,
  compactHistory,
} from "./history";

const SHOWN = new Set(["renderTable"]);

const big = { rows: "x".repeat(HISTORY_RESULT_MAX_CHARS * 2) };

function turn(id: string, toolName: string, value: unknown): ModelMessage[] {
  return [
    { role: "user", content: [{ type: "text", text: `pregunta ${id}` }] },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: id,
          toolName,
          input: { note: "y".repeat(HISTORY_INPUT_MAX_CHARS * 2) },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName,
          output: { type: "json", value: value as never },
        },
      ],
    },
    { role: "assistant", content: [{ type: "text", text: `respuesta ${id}` }] },
  ];
}

const resultOf = (m: ModelMessage | undefined) => {
  if (m?.role !== "tool") throw new Error("not a tool message");
  const part = m.content[0];
  if (part?.type !== "tool-result") throw new Error("not a result");
  return part.output;
};

describe("compactHistory", () => {
  it("clips earlier results and inputs with a marker, keeps the text", () => {
    const messages = [
      ...turn("a", "getBook", big),
      ...turn("b", "getBook", big),
    ];
    const out = compactHistory(messages, SHOWN);
    const old = resultOf(out[2]);
    expect(old.type).toBe("text");
    if (old.type !== "text") return;
    expect(old.value.length).toBeLessThan(HISTORY_RESULT_MAX_CHARS + 50);
    expect(old.value).toMatch(/…\[recortado: \d+ caracteres\]$/);
    const call = out[1];
    if (call?.role !== "assistant" || typeof call.content === "string") {
      throw new Error("not an assistant message");
    }
    expect(call.content[0]).toMatchObject({
      input: { recortado: expect.stringContaining("[recortado:") },
    });
    expect(out[3]).toEqual(messages[3]);
    expect(out[0]).toEqual(messages[0]);
  });

  it("leaves the current turn untouched", () => {
    const messages = [
      ...turn("a", "getBook", big),
      ...turn("b", "getBook", big),
    ];
    const out = compactHistory(messages, SHOWN);
    expect(out.slice(4)).toEqual(messages.slice(4));
  });

  it("drops the rows of artifacts already shown", () => {
    const table = {
      ok: true,
      summary: 'Table "IVA" shown to the user: 297 rows',
      data: { firstRows: [{ a: 1 }] },
      meta: { asOf: "x" },
    };
    const out = compactHistory(
      [...turn("a", "renderTable", table), ...turn("b", "getBook", {})],
      SHOWN,
    );
    expect(resultOf(out[2])).toEqual({
      type: "json",
      value: { ok: true, summary: table.summary, meta: table.meta },
    });
  });

  it("compacts a turn the same way every time (stable cached prefix)", () => {
    const messages = [
      ...turn("a", "getBook", big),
      ...turn("b", "getBook", big),
    ];
    expect(compactHistory(messages, SHOWN)).toEqual(
      compactHistory(structuredClone(messages), SHOWN),
    );
  });

  it("does nothing on a first turn", () => {
    const messages = turn("a", "getBook", big);
    expect(compactHistory(messages, SHOWN)).toBe(messages);
  });
});
