import { describe, expect, it } from "vitest";

import { artifactCsv } from "../artifacts/export";
import { RENDER_TOOLS } from "../artifacts/spec";

import {
  ANSWER_TABLE_ACTION,
  answerChunks,
  humanizeToolNames,
  parseEsArNumber,
  type AnswerChunk,
} from "./answer-text";
import { ASK_QUESTIONS_TOOL } from "./questions";
import { TOOL_LABELS } from "./tool-labels";

const { AI_ACTIONS } = await import("../registry/catalog");

function tables(chunks: AnswerChunk[]) {
  return chunks.flatMap((c) => (c.kind === "table" ? [c] : []));
}

describe("parseEsArNumber", () => {
  it.each([
    ["$ 1.234.567,89", 1234567.89, "money"],
    ["-$ 1.234,50", -1234.5, "money"],
    ["$ -1.234,50", -1234.5, "money"],
    ["($ 500)", -500, "money"],
    ["US$ 1.000,25", 1000.25, "usd"],
    ["21 %", 21, "percent"],
    ["10,5%", 10.5, "percent"],
    ["1.234", 1234, "number"],
    ["**$ 2.100,00**", null, null],
    ["42", 42, "number"],
    ["−7", -7, "number"],
  ])("%s", (raw, value, format) => {
    const parsed = parseEsArNumber(raw);
    if (value === null) expect(parsed).toBeNull();
    else expect(parsed).toEqual({ value, format });
  });

  it("rejects text, dates and en-US grouping", () => {
    expect(parseEsArNumber("Responsable inscripto")).toBeNull();
    expect(parseEsArNumber("01/09/2026")).toBeNull();
    expect(parseEsArNumber("1,234.56")).toBeNull();
    expect(parseEsArNumber("")).toBeNull();
  });
});

const IVA_ANSWER = `En **septiembre 2026** el saldo técnico de IVA da **$ 1.050.000,00** a pagar.

### Ventas vs compras

| Concepto | Neto gravado | IVA |
|:---------|-------------:|----:|
| **Ventas** | $ 10.000.000,00 | $ 2.100.000,00 |
| Compras | $ 5.000.000,00 | $ 1.050.000,00 |

**Por alícuota**

| Alícuota | Débito | Crédito |
| --- | --- | --- |
| 21 % | $ 2.000.000,00 | $ 1.000.000,00 |
| 10,5 % | $ 100.000,00 | — |

Posición estimada del sistema (\`getTaxDocuments\`): sin vencimientos pendientes.`;

describe("answerChunks", () => {
  it("keeps an answer without a table as one text chunk", () => {
    expect(answerChunks("Te deben **$ 1.000**.", "m:0")).toEqual([
      { kind: "text", text: "Te deben **$ 1.000**." },
    ]);
    // A pipe alone is not a table.
    expect(answerChunks("Ventas | compras", "m:0")).toEqual([
      { kind: "text", text: "Ventas | compras" },
    ]);
  });

  it("lifts every table out, in order, with the text before, between and after", () => {
    const chunks = answerChunks(IVA_ANSWER, "m1:2");
    expect(chunks.map((c) => c.kind)).toEqual([
      "text",
      "table",
      "table",
      "text",
    ]);
    const [first, second] = tables(chunks);
    expect(first?.id).toBe("m1:2:table1");
    expect(second?.id).toBe("m1:2:table2");
    expect(chunks[0]).toMatchObject({ kind: "text" });
    expect(chunks[0]?.kind === "text" && chunks[0].text).toContain(
      "saldo técnico",
    );
    // The headings now title the cards, so they leave the text.
    const text = chunks.map((c) => (c.kind === "text" ? c.text : "")).join("");
    expect(text).not.toContain("Ventas vs compras");
    expect(text).not.toContain("Por alícuota");
    expect(text).not.toContain("|");
  });

  it("titles a table with the heading or bold line before it, else its first column", () => {
    const [first, second] = tables(answerChunks(IVA_ANSWER, "m"));
    expect(first?.artifact.title).toBe("Ventas vs compras");
    expect(second?.artifact.title).toBe("Por alícuota");
    const [plain] = tables(
      answerChunks(
        "Mirá:\n\n| Cliente | Saldo |\n|---|---|\n| Acme | $ 10 |",
        "m",
      ),
    );
    expect(plain?.artifact.title).toBe("Cliente");
  });

  it("reads es-AR numbers into numeric columns, alignment rows aside", () => {
    const [first, second] = tables(answerChunks(IVA_ANSWER, "m"));
    expect(first?.artifact.columns).toEqual([
      { key: "c1", label: "Concepto", numeric: false, format: "text" },
      { key: "c2", label: "Neto gravado", numeric: true, format: "money" },
      { key: "c3", label: "IVA", numeric: true, format: "money" },
    ]);
    expect(first?.artifact.rows).toEqual([
      ["Ventas", 10_000_000, 2_100_000],
      ["Compras", 5_000_000, 1_050_000],
    ]);
    // Every cell of the first column is a percent; an em dash is empty.
    expect(second?.artifact.columns[0]).toMatchObject({ format: "percent" });
    expect(second?.artifact.rows).toEqual([
      [21, 2_000_000, 1_000_000],
      [10.5, 100_000, null],
    ]);
  });

  it("exports the lifted figures as numbers", () => {
    const [first] = tables(answerChunks(IVA_ANSWER, "m"));
    if (!first) throw new Error("no table");
    const { csv } = artifactCsv(first.artifact);
    expect(csv).toContain("10000000");
    expect(csv).not.toContain("10.000.000,00");
  });

  it("marks lifted tables as coming from the answer (no query to pin)", () => {
    const [first] = tables(answerChunks(IVA_ANSWER, "m"));
    expect(first?.artifact.source).toEqual({
      action: ANSWER_TABLE_ACTION,
      input: {},
    });
  });

  it("humanizes a tool name in the text it keeps", () => {
    const chunks = answerChunks(IVA_ANSWER, "m");
    const last = chunks.at(-1);
    expect(last?.kind === "text" && last.text).toContain(
      "Posición estimada del sistema (Impuestos)",
    );
  });
});

describe("humanizeToolNames", () => {
  it("rewrites bare names and inline code holding one", () => {
    expect(
      humanizeToolNames("Según `getLibroIvaVentas` y getLibroIvaCompras()"),
    ).toBe("Según IVA Ventas y IVA Compras");
  });

  it("leaves words that only contain a name alone", () => {
    expect(humanizeToolNames("xgetInvoicesy")).toBe("xgetInvoicesy");
  });

  it("every tool the assistant can call has a label", () => {
    const names = [
      ...AI_ACTIONS.map((a) => a.name),
      ...RENDER_TOOLS,
      ASK_QUESTIONS_TOOL,
      "openAttachment",
    ];
    expect(names.filter((n) => !(n in TOOL_LABELS))).toEqual([]);
  });

  it("an answer naming every registered tool reaches the user without one", () => {
    const names = AI_ACTIONS.map((a) => a.name);
    const answer = names
      .map((n, i) => (i % 2 ? `Dato de \`${n}\`.` : `Según ${n}: ok.`))
      .join("\n");
    const shown = answerChunks(answer, "m")
      .map((c) => (c.kind === "text" ? c.text : ""))
      .join("");
    for (const n of names) expect(shown).not.toMatch(new RegExp(`\\b${n}\\b`));
    expect(shown).not.toContain("`");
  });
});
