import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { resolveAccess } from "@/lib/auth/permissions";

import { libroIvaAggregates } from "./actions/accounting";
import { defineAiAction } from "./define";
import {
  MODEL_VIEW_MAX_CHARS,
  MODEL_VIEW_ROWS,
  clipText,
  modelOutput,
  modelView,
  okResult,
} from "./result";

const meta = {
  sources: ["libro_iva_ventas"],
  asOf: "2026-11-07",
  partial: false,
};

const row = (i: number) => ({
  comprobante: `A0003-${String(22_000 + i).padStart(8, "0")}`,
  client_legal_name: `Cliente ${i}`,
  invoice_id: `id-${i}`,
  kind: "invoice",
  neto: 1_000 + i,
  iva: 210,
  imp_total: 1_210 + i,
});

const book = (n: number) => ({
  ok: true,
  summary: `Solo fiscal: VAT Sales 2026-10: ${n} documents`,
  data: {
    rows: Array.from({ length: n }, (_, i) => row(i)),
    totals: { documents: n, iva: 210 * n },
  },
  meta,
});

describe("modelView", () => {
  it("passes a small result through untouched", () => {
    const small = book(3);
    expect(modelView(small)).toBe(small);
  });

  it("cuts a long list to its first rows and says how many there were", () => {
    const view = modelView(book(297));
    expect(view).toMatchObject({
      summary: expect.stringContaining("297 documents"),
      meta,
      data: { totals: { documents: 297, iva: 210 * 297 } },
      listsCut: [
        {
          path: "rows",
          rows: 297,
          columns: Object.keys(row(0)),
        },
      ],
      listsCutNote: expect.stringContaining("renderTable"),
    });
    const shown = (view as { data: { rows: unknown[] } }).data.rows;
    expect(shown.length).toBeLessThanOrEqual(MODEL_VIEW_ROWS);
    expect(shown[0]).toEqual(row(0));
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(
      MODEL_VIEW_MAX_CHARS,
    );
  });

  it("steps the rows down until wide rows fit the budget", () => {
    const wide = {
      ok: true,
      summary: "wide",
      data: Array.from({ length: 60 }, (_, i) => ({
        i,
        text: "x".repeat(900),
      })),
      meta,
    };
    const view = modelView(wide) as { data: unknown[]; listsCut: unknown[] };
    expect(view.data.length).toBeLessThan(MODEL_VIEW_ROWS);
    expect(view.listsCut).toEqual([
      expect.objectContaining({ path: "(root)", rows: 60 }),
    ]);
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(
      MODEL_VIEW_MAX_CHARS,
    );
  });

  it("leaves errors and results without data alone", () => {
    const err = { ok: false, summary: "Failed: x", error: "x" };
    expect(modelView(err)).toBe(err);
    expect(modelView("text")).toBe("text");
  });

  it("adds the action's aggregates only when a list was cut", () => {
    const aggregates = vi.fn(() => ({ top: 1 }));
    expect(modelView(book(3), aggregates)).not.toHaveProperty("aggregates");
    expect(modelView(book(297), aggregates)).toHaveProperty("aggregates", {
      top: 1,
    });
  });

  it("is JSON the SDK can send", () => {
    expect(modelOutput(book(297))).toMatchObject({
      type: "json",
      value: { listsCut: [{ rows: 297 }] },
    });
  });
});

describe("clipText", () => {
  it("marks what it cut", () => {
    expect(clipText("abcdef", 4)).toBe("abcd…[recortado: 2 caracteres]");
    expect(clipText("abc", 4)).toBe("abc");
  });
});

describe("read actions", () => {
  const access = resolveAccess(["owner"]);
  const run = vi.fn(async (_ctx: unknown, input: { period: string }) =>
    input.period === "bad"
      ? { ok: false as const, summary: "Failed: x", error: "x" }
      : okResult(`book ${input.period}`, book(297).data),
  );
  const action = defineAiAction({
    name: "getBook",
    domain: "contabilidad",
    description: "Book.",
    input: z.object({ period: z.string() }),
    permission: "accounting:read",
    sideEffect: "read",
    sources: ["libro_iva_ventas"],
    run,
  });

  it("run once per turn for the same input; failures are not kept", async () => {
    run.mockClear();
    const ctx = { userId: "u1", access, readCache: new Map() };
    const a = await action.execute(ctx, { period: "2026-10" });
    const b = await action.execute(ctx, { period: "2026-10" });
    expect(b).toBe(a);
    await action.execute(ctx, { period: "2026-09" });
    await action.execute(ctx, { period: "bad" });
    await action.execute(ctx, { period: "bad" });
    expect(run).toHaveBeenCalledTimes(4);
    await action.execute({ userId: "u1", access }, { period: "2026-10" });
    expect(run).toHaveBeenCalledTimes(5);
  });

  it("send the model the view and keep every row in the output", async () => {
    const t = action.toTool({ userId: "u1", access });
    const output = await t.execute?.(
      { period: "2026-10" },
      { toolCallId: "c1", messages: [], context: undefined },
    );
    expect(output).toMatchObject({ data: { rows: { length: 297 } } });
    const forModel = await t.toModelOutput?.({
      toolCallId: "c1",
      input: { period: "2026-10" },
      output,
    });
    expect(forModel).toMatchObject({
      type: "json",
      value: { listsCut: [{ rows: 297 }] },
    });
  });
});

describe("libroIvaAggregates", () => {
  it("counts each document once and subtracts credit notes", () => {
    const aggregates = libroIvaAggregates("invoice_id", "client_legal_name");
    expect(
      aggregates({
        rows: [
          {
            invoice_id: "1",
            client_legal_name: "Acme",
            kind: "invoice",
            imp_total: 100,
          },
          {
            invoice_id: "1",
            client_legal_name: "Acme",
            kind: "invoice",
            imp_total: 100,
          },
          {
            invoice_id: "2",
            client_legal_name: "Acme",
            kind: "nc",
            imp_total: 30,
          },
          {
            invoice_id: "3",
            client_legal_name: "Beta",
            kind: "invoice",
            imp_total: 50,
          },
        ],
      }),
    ).toEqual({
      documents_by_kind: { invoice: 2, nc: 1 },
      counterparties: 2,
      top_counterparties_by_total: [
        { name: "Acme", documents: 2, imp_total: 70 },
        { name: "Beta", documents: 1, imp_total: 50 },
      ],
    });
    expect(aggregates([])).toBeNull();
  });
});
